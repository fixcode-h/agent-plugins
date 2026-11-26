import { parseRunSub } from '../../gt-tool-card/link.ts'
import {
  BookOpen,
  CircleCheck,
  CircleDot,
  CircleX,
  FileJson,
  FlaskConical,
  Folder,
  Layers,
  ListTree,
  Loader2,
  Play,
  Plus,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react'
import { ObjectsTab } from './gt-objects/ObjectsTab.tsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { pageMenu, type MenuItem } from '@panel/web/src/components/ui/item-menu'
import { Confirm, ErrorText } from '../../ui.tsx'
import { useScenarioMenus, type Scenario } from './GtMenus.tsx'
import { useScenarioLibrary } from './GtLibrary.tsx'
import { GtBatchBar } from './GtBatch.tsx'
import { GtHistoryBar } from './GtHistoryBar.tsx'
import { GtOfflineBar } from './GtOffline.tsx'
import { useGtAgentWrite } from './gt-author/GtAgentWrite.tsx'
import { GtRecord, HitPathNote, type RecordStatus } from './GtRecord.tsx'
import { EDITOR_RECORD_HELP, GtEditorRecord } from './GtEditorRecord.tsx'
import { editorRecordSupported } from './gt-editor-steps.ts'
import { ocrAfterRecord, shotsArg } from './gt-ocr.ts'
import { keyAskArgs } from './gt-key.ts'
import { GtKeyAsk } from './GtKeyAsk.tsx'
import { GtKeyRulesPanel } from './GtKeyRulesPanel.tsx'
import { useShotMenus } from './GtShotMenus.tsx'
import { batchDone, batchTags, loadHistory, mergeJobEvent } from './gt-batch.ts'
import { legacySteps } from './gt-steps.ts'
import { runStart } from './gt-rows/rows.ts'
import { getAt, parsePath } from '../../../shared/gt-script/index.ts'
import { recordSegmentArgs, segmentSupported } from './gt-record-segment.ts'
import { recordSkipArgs, skipSupported } from './gt-skip.ts'
import { GtSettings } from './GtSettings.tsx'
import { GtEditor } from './gt-edit/index.ts'
import { ApiLibrary } from './gt-api/ApiLibrary.tsx'
import type { GtJob, GtRunSummary, GtScenarioFile } from './gt-run/types.ts'
import { ListCol, useExtEvents } from './ListCol.tsx'
import { NodeShelf } from './NodeShelf.tsx'
import { nameTaken, uniqueName } from './gt-names.ts'
import { NotInstalled } from './NotInstalled.tsx'
import { FileTree, type TreeLeaf } from './tree.tsx'
import { GT_COPY_MIME, GT_STEPS_MIME } from './gt-flow/dnd.ts'

/**
 * GameTest 页（UEKit 扩展，设计稿 designs/GameTest整页编辑器与蓝图画布-设计稿.md）：二级栏是「脚本 / 节点 / 最近运行」三页
 * （场景树和表格页一样的文件树、节点面板、最近运行），右边直接是选中脚本的整页编辑器（2026-11-19 起没有单独的运行结果页：
 * 上次结果在画布左上角，报告和历史在编辑器右栏的「运行」页）。进来时打开上次看的脚本，没有就打开第一个。
 * 运行中、录制中的状态靠推送事件（gt.job、gt.record）更新，不轮询。
 * 跑测试要 UE 编辑器开着（PIE 由场景自己的 pie.start 步骤起）。编辑器没连上（没开或正忙）时页面照常显示：
 * 场景列表、最近运行、历史和报告由面板从磁盘读（服务端 uekit/gt-disk.ts），只有录制、运行、核对选择器不能用。
 */
interface ScenarioList {
  scenarios: Scenario[]
  rootDir: string
  /** 场景根的绝对路径：面板按它直接读写场景文件 */
  absoluteRootDir?: string
}

/** 上次打开的脚本（每个项目各记一个，存浏览器）：再进 GameTest 时直接打开它 */
const lastKey = (project: string) => `ue.gt.last:${project}`
const readLast = (project: string) => {
  try {
    return localStorage.getItem(lastKey(project)) ?? undefined
  } catch {
    return undefined
  }
}
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

export function GameTest() {
  const { project, state, sub: rawSub, go } = useUe()
  // 对话里 ue_gametest 的工具卡片跳过来时带着这次运行（gt-tool-card/link.ts）：打开脚本，右栏看这次的报告
  const { path: sub, run: subRun } = parseRunSub(rawSub)
  const { ui, cn } = h()
  const { busy, run } = useAction()
  const installed = state?.extensions?.some((x) => x.name === 'GameTest')
  const live = (state?.instances ?? []).some((i) => i.kind === 'editor' && i.online)
  const gtVersion = state?.extensions?.find((x) => x.name === 'GameTest')?.version
  const [list, setList] = useState<ScenarioList>()
  const [runs, setRuns] = useState<GtRunSummary[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'scenarios' | 'objects' | 'runs'>('scenarios')
  // 「节点」页签里给编辑器画节点面板的位置（编辑器用 portal 画进来）
  const [paletteHost, setPaletteHost] = useState<HTMLDivElement | null>(null)
  // 左栏「最近运行」里点的那次：打开那个脚本，右栏看这次的报告
  const [openRun, setOpenRun] = useState<{ scenario: string; runId: string; n: number }>()
  // 编辑器里有没存的改动：换脚本前问一句（要换去的脚本先记在 switchTo）
  const dirty = useRef(false)
  const [switchTo, setSwitchTo] = useState<string>()
  const onDirty = useCallback((d: boolean) => {
    dirty.current = d
  }, [])
  const [apiLib, setApiLib] = useState(false)
  const [job, setJob] = useState<GtJob>()
  const [rec, setRec] = useState<RecordStatus>()
  const [asking, setAsking] = useState(false)
  // 运行设置弹窗（阻挡界面规则、UI 等待上限）
  const [settings, setSettings] = useState(false)
  // 条目规则面板（_settings.json 的 itemKeys，树形、可搜）：直接读写磁盘，编辑器没开也能整理
  const [keyRules, setKeyRules] = useState(false)
  const [recName, setRecName] = useState('')
  // 「在这里录制」「新建脚本（录制）」：录完从 recorded/ 挪进这个文件夹（GameTest 只会存到 recorded/）
  const [recordDir, setRecordDir] = useState<string>()
  // 「保留节奏」：UI 操作之间也录 wait（默认不录，回放的 click / type 自己等控件可操作）
  const [keepPace, setKeepPace] = useState(false)
  // 录游戏（PIE 里的操作）还是录 UE 编辑器操作（GameTest 1.11.0，定稿 10.1）
  const [recTarget, setRecTarget] = useState<'game' | 'editor'>('game')
  // 录制器认控件靠什么：hitPath 表示这个进程没编 Slate 调试，打字录不到，开始录制前就提示
  const [handlerSource, setHandlerSource] = useState<string>()
  // 推送里已经结束的 run：第一步就失败的 run 在 gt.run 返回之前就推了「结束」，返回后不能再标成运行中
  const finished = useRef(new Set<string>())
  // 每个场景最近 10 次的通过 / 失败（GameTest 1.2 的 gt.history，最新在前）；旧版本没有这个操作时是空的，列表退回只看最近一次
  const [history, setHistory] = useState<Record<string, string>>({})
  // 跑完的批量结果关掉了（按批量编号记）
  const [closedBatch, setClosedBatch] = useState<string>()
  // 推送里批量已经跑完了几个（跑完一个就重拉历史）
  const batchSeen = useRef(0)

  // 脚本列表、最近运行、历史都是磁盘上的文件（场景根的 JSON、Saved/GameTest 的产物和 history.json），一律由面板直接读：
  // 用户 2026-11-19 报编辑器开着但游戏线程忙（或 UELink / GameTest 没编新版）时，列表等 UE 回应 30 秒后整页报错，
  // 看和编辑脚本本来就不需要编辑器，只有运行、录制这些才连 UE
  const disk = { disk: true }
  const reload = () => {
    op<ScenarioList>(project.id, 'gt.scenarios', { limit: 1000, ...disk })
      .then((r) => {
        setList(r)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
    void op<{ runs: GtRunSummary[] }>(project.id, 'gt.runs', disk)
      .then((r) => setRuns(r.runs ?? []))
      .catch(() => undefined)
    void loadHistory(project.id, true).then(setHistory)
  }
  useEffect(() => {
    if (!installed) return
    reload()
    if (!live) {
      // 编辑器关了：作业、录制状态跟着清掉（推送断了，留着会一直显示运行中）
      setJob(undefined)
      setRec(undefined)
      return
    }
    void op<GtJob>(project.id, 'gt.job', { steps: 200 })
      .then((j) => (j.busy || j.batch) && setJob(j))
      .catch(() => undefined)
    void op<RecordStatus>(project.id, 'gt.record.status', { last: 20 })
      .then((r) => {
        setHandlerSource(r.handlerSource)
        if (r.recording) setRec(r)
      })
      .catch(() => undefined)
    // 正在录编辑器操作（刷新了页面）：GameTest 1.11.0 起才有，旧版本报不认识的操作，忽略
    if (editorRecordSupported(gtVersion))
      void op<RecordStatus>(project.id, 'gt.editrec.status', { last: 200 })
        .then((r) => r.recording && setRec(r))
        .catch(() => undefined)
    // 换项目、编辑器起来或关掉时重拉（数据换成 UE 的或磁盘的）；reload 每次渲染都是新函数
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, installed, live])

  // 面板连没连上 UE 的推送通道（服务端 uekit/stream.ts 推的 link 事件）：断着时录到的步骤、计时都到不了页面
  const [linked, setLinked] = useState<boolean>()
  // 推送断过又连上：断的这段时间录制可能已经在 UE 工具栏上停了、或录了好几步，按 UE 现在的状态重来一遍
  const syncRec = () => {
    void op<RecordStatus>(project.id, 'gt.record.status', { last: 200 })
      .then((r) => {
        setHandlerSource(r.handlerSource)
        setRec((old) => {
          if (r.recording) return { ...r, last: r.last ?? old?.last }
          // 面板以为在录（游戏录制），UE 那边已经停了：退出录制界面
          if (old?.recording && old.target !== 'editor') {
            reload()
            return undefined
          }
          return old
        })
      })
      .catch(() => undefined)
  }

  useExtEvents(project.id, (e) => {
    if (e.event === 'link') {
      setLinked(!!e.connected)
      if (e.connected && live) syncRec()
    } else if (e.event === 'gt.job') {
      const j = e as unknown as GtJob & { phase?: string; lastStep?: GtJob['steps'][number] }
      setJob((old) => mergeJobEvent(old, j))
      // 批量里每跑完一个场景，历史条和最近运行就要跟上：整批跑完前事件一直是 progress，按跑完的个数变没变判断
      const done = batchDone(j.batch)
      const moreDone = done > batchSeen.current
      batchSeen.current = j.batch ? done : 0
      if (j.phase === 'finished' || moreDone) {
        if (j.runId) finished.current.add(j.runId)
        reload()
      }
    } else if (e.event === 'gt.record') {
      const r = e as unknown as RecordStatus & { phase?: string }
      setRec((old) => {
        if (r.phase === 'started') return { ...r, last: [] }
        // 事件里的 last 只有最新一步；录移动每秒、快捷动作改状态（GameTest 1.3.0）也会推，步数没涨就不追加，免得一步显示几遍
        const added = (r.steps ?? 0) - (old?.steps ?? 0)
        const fresh = added > 0 ? (r.last ?? []).slice(-added) : []
        // 录编辑器时连着改同一个属性合成一步，步数不涨、最后一步的值变了：换掉最后一行
        if (r.target === 'editor' && added === 0 && r.phase === 'step' && r.last?.length && old?.last?.length)
          return { ...r, last: [...old.last.slice(0, -1), ...r.last.slice(-1)] }
        return { ...r, last: [...(old?.last ?? []), ...fresh].slice(-200) }
      })
      if (r.phase === 'stopped') reload()
      // 改了某一步的认法（可能连同一列表的好几步一起改）：事件只带最新一步，前面的步骤重新取一遍
      if (r.phase === 'key' || r.phase === 'askEnd')
        void op<RecordStatus>(project.id, 'gt.record.status', { last: 200 })
          .then((s) => s.recording && setRec((old) => ({ ...s, last: s.last ?? old?.last })))
          .catch(() => undefined)
    }
  })

  // 每个场景最近一次 run：GameTest 1.2 起按场景文件认（场景重名也分得清），旧版本按名字
  const lastRun = useMemo(() => {
    const m = new Map<string, GtRunSummary>()
    for (const r of runs) {
      const key = r.scenario ?? r.name
      if (!m.has(key) || (r.startedAtUtc ?? '') > (m.get(key)!.startedAtUtc ?? '')) m.set(key, r)
    }
    return m
  }, [runs])
  const lastOf = (s: Scenario) => lastRun.get(s.relativePath) ?? lastRun.get(s.name)
  const q = query.trim().toLowerCase()
  // 正在录的脚本还没存盘（停止时 UE 才写文件）：左栏先放一条占位，选中它，录完换成真正的文件（用户 2026-11-19）
  const recLeaf: Scenario | undefined =
    rec?.recording && !rec.insert
      ? {
          name: rec.name ?? '',
          relativePath: `${recordDir || 'recorded'}/${rec.name ?? ''}.json`,
          steps: rec.steps ?? rec.last?.length ?? 0,
          tags: ['recorded'],
        }
      : undefined
  const items: TreeLeaf<Scenario>[] = useMemo(
    () =>
      [...(list?.scenarios ?? []), ...(recLeaf ? [recLeaf] : [])]
        // _ 开头的是场景根的配置和生成物（_settings.json、_vars.json、_api.json），不是场景
        .filter((s) => !/(^|\/)_[^/]*$/.test(s.relativePath))
        .filter((s) => !q || `${s.name} ${s.relativePath} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(q))
        .map((s) => ({ path: s.relativePath.replace(/\.json$/i, ''), data: s })),
    // recLeaf 每次渲染都是新对象，按它的路径和步数判断变没变
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [list, q, recLeaf?.relativePath, recLeaf?.steps],
  )

  const selected = list?.scenarios.find((s) => s.relativePath === sub)
  useEffect(() => {
    if (sub && subRun) setOpenRun({ scenario: sub, runId: subRun, n: Date.now() })
  }, [sub, subRun])
  // 从「调用脚本」双击进来的一层层调用方（子图，用户 2026-11-19）：打开的就是被调用的脚本本身，面包屑点了回去；
  // 从脚本库换到别的脚本时清掉
  const [callers, setCallers] = useState<{ path: string; name: string; to: string }[]>([])
  useEffect(() => {
    if (callers.length && callers[callers.length - 1].to !== sub) setCallers([])
  }, [sub, callers])
  const openCall = (script: string) => {
    const want = script.replace(/\.json$/i, '').toLowerCase()
    const hit = list?.scenarios.find((x) => x.relativePath.replace(/\.json$/i, '').toLowerCase() === want)
    if (!hit || !selected) return h().toast.error(t('场景库里找不到 {s}', { s: script }))
    setCallers((c) => [...c, { path: selected.relativePath, name: selected.name, to: hit.relativePath }])
    open(hit.relativePath)
  }
  const callerCrumbs = callers.map((c, i) => ({
    label: c.name,
    onClick: () => {
      setCallers(callers.slice(0, i).map((x, j) => (j === i - 1 ? { ...x, to: c.path } : x)))
      open(c.path)
    },
  }))
  /** 打开另一个脚本：编辑器里有没存的改动时先问一句 */
  const open = (p: string) => {
    if (p === selected?.relativePath) return
    if (dirty.current && selected) return setSwitchTo(p)
    go('gametest', p)
  }
  // 只在进页面时（列表第一次读回来）打开上次看的脚本，没有就打开第一个。之后点哪个打开哪个：
  // 删掉打开着的脚本右边就空着，新建的脚本等列表重拉回来再选中，都不再自动跳去别的脚本
  // （以前每次选中落空都自动打开上次那个，新建、删除后都跳回「冒烟」，用户 2026-11-21 报）
  const autoOpened = useRef('')
  useEffect(() => {
    if (!list || autoOpened.current === project.id) return
    autoOpened.current = project.id
    if (selected || rec?.recording) return
    const all = list.scenarios.map((x) => x.relativePath).filter((x) => !/(^|\/)_[^/]*$/.test(x))
    if (!all.length) return
    const last = readLast(project.id)
    go('gametest', last && all.includes(last) ? last : all[0])
    // 每个项目只在列表第一次读回来时看一次；go 每次渲染都是新函数
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [list, project.id])
  useEffect(() => {
    if (!selected) return
    dirty.current = false
    try {
      localStorage.setItem(lastKey(project.id), selected.relativePath)
    } catch {
      // 存不了就下次打开第一个
    }
  }, [selected, project.id])
  // 已经出现在最近运行里的 run 一定跑完了：推送丢了、页面晚连上时也不会一直停在「运行中」
  const batch = job?.batch && job.batch.id !== closedBatch ? job.batch : undefined
  const batchActive = !!job?.batch?.active
  const running = (!!job?.busy && !runs.some((r) => r.runId === job.runId)) || batchActive
  const recording = !!rec?.recording
  /** 开跑：gt.run 里 UE 会立刻推进一次，第一步就失败的 run 返回时已经结束（finished），这时不再标成运行中 */
  const startRun = (name: string, args: Record<string, unknown>) =>
    run('run', async () => {
      const r = await op<{ runId: string; steps: number; finished?: boolean }>(project.id, 'gt.run', args)
      if (r.finished || finished.current.has(r.runId)) {
        setJob(undefined)
        reload()
        return
      }
      // 推送可能比返回先到：已经有这次 run 的进度就留着
      setJob((old) =>
        old?.runId === r.runId
          ? old
          : { runId: r.runId, status: 'running', busy: true, name, steps: [], total: 0, planned: r.steps, failed: 0 },
      )
    })
  /** ignoreSkipIf：全部照做（GameTest 1.7.0），每一步都真做，测第一次领取、新号这类路径 */
  /** extra：编辑页的调试参数（params、from / to、breakpoints，GameTest 1.9 的 gt.run），原样并进去 */
  const runScenario = (s: Scenario, ignoreSkipIf?: boolean, extra?: Record<string, unknown>) =>
    startRun(s.name, { scenario: s.relativePath, ...(ignoreSkipIf ? { ignoreSkipIf: true } : {}), ...extra })
  /** 批量：一个接一个跑（GameTest 1.2），进度和结果从 gt.job 事件的 batch 来 */
  const startBatch = (args: { tag?: string; scenarios?: string[]; name?: string }) =>
    run('run', async () => {
      const r = await op<{ batchId: string; scenarios: number }>(project.id, 'gt.run', args)
      setClosedBatch(undefined)
      // 推送可能比返回先到：已经有这一批的进度就留着
      setJob((old) =>
        old?.batch?.id === r.batchId
          ? old
          : {
              status: 'running',
              busy: true,
              steps: [],
              total: 0,
              failed: 0,
              batch: {
                id: r.batchId,
                label: args.name ?? (args.tag ? `tag:${args.tag}` : ''),
                active: true,
                total: r.scenarios,
                passed: 0,
                failed: 0,
              },
            },
      )
    })
  const tags = useMemo(() => batchTags(list?.scenarios ?? []), [list])
  /** 批量运行的菜单项：按标签或全部场景，一个接一个跑（并在「运行」旁的下拉里） */
  const batchItems = (): (MenuItem | false)[] => [
    { title: t('批量运行') },
    ...tags.map(([tag, n]) => ({
      label: tag,
      icon: Layers,
      hint: t('{n} 个场景', { n }),
      onClick: () => void startBatch({ tag }),
    })),
    tags.length > 0 && 'sep',
    {
      label: t('全部场景'),
      icon: Layers,
      hint: t('{n} 个场景', { n: (list?.scenarios ?? []).filter((s) => !s.parseError).length }),
      disabled: !list?.scenarios.some((s) => !s.parseError),
      onClick: () =>
        void startBatch({
          scenarios: (list?.scenarios ?? []).filter((s) => !s.parseError).map((s) => s.relativePath),
          name: t('全部场景'),
        }),
    },
  ]
  /**
   * 从这一步跑到底；only 时只跑这一步（临时运行，不跑前置步骤、不记进场景的运行历史）。
   * 顶层的步骤照旧截出来交给 gt.run（旧 GameTest 也能跑）；录制段等块里的步骤：只跑这一步时单独交这一步，
   * 跑到底时用 gt.run 的 from（GameTest 1.9.0，按路径从场景里这一步开始，块外面后面的步骤也接着跑）
   */
  const runFrom = (s: Scenario, file: GtScenarioFile, at: { key: string }, only?: boolean) => {
    const start = runStart(at.key)
    if ('from' in start) {
      if (!only) return runScenario(s, false, { from: start.from })
      const step = getAt(file, parsePath(at.key))
      return startRun(s.name, { name: s.name, steps: [step], stepDelayMs: file.stepDelayMs })
    }
    const i = start.index
    return startRun(s.name, {
      name: s.name,
      steps: legacySteps(file.steps, file.schemaVersion ?? 1).slice(i, only ? i + 1 : undefined),
      stepDelayMs: file.stepDelayMs,
    })
  }
  /**
   * 停止：gt.stop 只是请求取消，结果以 UE 的作业状态为准——已经不在跑（例如早就失败结束、推送没到）时
   * 直接收尾，不让按钮按了没反应
   */
  const stop = () =>
    run('stop', async () => {
      await op(project.id, 'gt.stop')
      const j = await op<GtJob>(project.id, 'gt.job', { steps: 0 })
      if (!j.busy) {
        setJob(undefined)
        reload()
      }
    })
  const shots = useShotMenus({ project: project.id, root: list?.absoluteRootDir ?? '', reload })
  const locked = !live || running || recording || !!busy
  const agentWrite = useGtAgentWrite(list?.absoluteRootDir ?? '')
  const lib = useScenarioLibrary({
    project: project.id,
    root: list?.absoluteRootDir ?? '',
    rootLabel: list?.rootDir ?? '',
    scenarios: list?.scenarios ?? [],
    selected: selected?.relativePath,
    reload,
    // 不给路径是打开着的脚本被删了：右边空着，不自动换去别的脚本
    open: (p) => (p ? open(p) : go('gametest', p)),
    recordIn: live
      ? (dir) => {
          setRecordDir(dir || undefined)
          setAsking(true)
        }
      : undefined,
    agentWriteIn: (dir) => agentWrite.open(dir),
    runBatch: (scenarios, label) => void startBatch({ scenarios, name: label }),
    locked,
  })
  const menus = useScenarioMenus({
    project: project.id,
    shotItems: shots.items,
    root: list?.absoluteRootDir ?? '',
    locked,
    reload,
    open: (s) => open(s.relativePath),
    runScenario,
    scenarios: list?.scenarios ?? [],
    rename: lib.renameScenario,
    remove: lib.removeScenario,
  })
  /** insert：编辑页「从这里接着录」，录到的段插进这个场景 after 这一步后面（GameTest 1.10.0） */
  // 录制默认名（用户 2026-11-19）：Test，被占用就 Test1、Test2……；只当输入框的占位提示，不填进框里，不输就用它
  const recDefault = uniqueName(list?.scenarios ?? [], 'Test')
  const recNameError = recName.trim() ? nameTaken(list?.scenarios ?? [], recName) : undefined
  const startRecord = (insert?: { scenario: string; after?: string }) =>
    run('record', async () => {
      if (!insert && recNameError) return
      setAsking(false)
      // 名字只用这一次：下回打开录制弹窗又是空框 + 新的默认名，不会沿用上次的名字录出同名脚本
      const name = recName.trim() || recDefault
      setRecName('')
      // 接着录存回原场景，不挪文件夹
      if (insert) setRecordDir(undefined)
      if (!insert && recTarget === 'editor' && editorRecordSupported(gtVersion)) {
        const e = await op<RecordStatus>(project.id, 'gt.editrec.start', { name })
        setRec({ ...e, target: 'editor', last: [] })
        return
      }
      const r = await op<RecordStatus>(project.id, 'gt.record.start', {
        name: insert ? t('接着录') : name,
        keepPace,
        shots: shotsArg(gtVersion),
        ...keyAskArgs(),
        ...recordSkipArgs(gtVersion),
        ...recordSegmentArgs(gtVersion, insert),
      })
      setRec({ ...r, last: [] })
    })

  if (state && !installed) return <NotInstalled name="GameTest" />
  // 录制、运行、批量要编辑器：没连上时按钮置灰，悬停说明为什么
  const needEditor = live ? '' : t('要先启动编辑器')
  const tip = (s: string) => (needEditor ? `${s}（${needEditor}）` : s)
  const startRecordIn = (dir?: string) => {
    setRecordDir(dir || undefined)
    setAsking(true)
  }
  const usable = (list?.scenarios ?? []).filter((s) => !s.parseError)
  /** 「运行」下拉里接在编辑器自己的几项后面：全部照做、跑这个文件夹、按标签 / 全部批量运行（原来在场景列表标题行） */
  const runExtra = (s: Scenario): (MenuItem | false)[] => {
    const dir = dirOf(s.relativePath)
    const inDir = usable.filter((x) => dirOf(x.relativePath) === dir)
    return [
      {
        label: t('全部照做'),
        icon: Play,
        hint: t('忽略已达成就跳过，每一步都真做'),
        disabled: !skipSupported(gtVersion),
        onClick: () => void runScenario(s, true),
      },
      'sep',
      { title: t('批量运行') },
      !!dir && {
        label: t('跑这个文件夹'),
        icon: Folder,
        hint: t('{n} 个场景', { n: inDir.length }),
        onClick: () => void startBatch({ scenarios: inDir.map((x) => x.relativePath), name: dir }),
      },
      ...batchItems().slice(1),
    ]
  }
  /** 顶栏「⋯」里接在后面的：运行设置、接口库、条目规则（原来在场景列表搜索框旁的「⋯」） */
  const moreItems: MenuItem[] = [
    {
      label: t('运行设置'),
      icon: SlidersHorizontal,
      disabled: !live,
      onClick: () => setSettings(true),
    },
    {
      label: t('接口库'),
      icon: BookOpen,
      disabled: !list?.absoluteRootDir,
      onClick: () => setApiLib(true),
    },
    {
      label: t('条目规则'),
      icon: ListTree,
      disabled: !list?.absoluteRootDir,
      onClick: () => setKeyRules(true),
    },
  ]

  return (
    <div
      onContextMenu={pageMenu}
      className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto ue:md:flex-row ue:md:overflow-hidden"
    >
      <ListCol
        id="gametest"
        title="GameTest"
        count={list?.scenarios.length ?? '…'}
        query={query}
        onQuery={setQuery}
        placeholder={t('找场景或节点')}
        // 空白处右键：在场景根新建脚本、文件夹（其他页签没有可新建的，交给整页兜底）
        onBodyMenu={tab === 'scenarios' ? lib.blankMenu : undefined}
        searchExtra={
          <>
            <ui.IconButton
              icon={Plus}
              size="sm"
              label={t('新建：脚本（编写 / 录制）、文件夹，建在选中的文件夹里')}
              disabled={!list?.absoluteRootDir}
              onClick={lib.newMenu}
            />
            <ui.IconButton
              icon={CircleDot}
              size="sm"
              label={tip(t('录制：在游戏窗口里操作一遍，录成场景'))}
              disabled={!live || recording || running || !!busy}
              onClick={() => startRecordIn(undefined)}
            />
          </>
        }
        // 节点常驻在搜索框下面（用户 2026-11-19：不用单独一个页签），搜索框同时筛节点和场景
        shelf={
          selected && !recording ? (
            <NodeShelf
              hint={t(
                '拖到画布上放下，或在连线上点 +；点一下插在选中那步后面。从下面的脚本列表拖一个脚本进画布就是「调用脚本」',
              )}
            >
              <div ref={setPaletteHost} />
            </NodeShelf>
          ) : undefined
        }
        tabs={
          <ui.Segmented
            size="sm"
            fill
            label={t('脚本 / 对象 / 最近运行')}
            value={tab}
            onChange={setTab}
            options={[
              { id: 'scenarios', label: t('脚本') },
              { id: 'objects', label: t('对象') },
              { id: 'runs', label: `${t('最近运行')} ${runs.length}` },
            ]}
          />
        }
        footer={
          <>
            <span>
              {t('场景根')} <code className="ue:font-mono ue:text-muted">{list?.rootDir || '…'}</code>
            </span>
            {shots.footer}
          </>
        }
      >
        {error ? (
          <ErrorText>{error}</ErrorText>
        ) : !list ? (
          <div className="ue:flex ue:justify-center ue:p-6 ue:text-subtle">
            <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
          </div>
        ) : tab === 'objects' ? (
          <ObjectsTab project={project.id} live={live} q={q} />
        ) : tab === 'runs' ? (
          <RunList
            runs={runs}
            offline={!live}
            onMenu={menus.runMenu}
            onOpen={(r) => {
              const s = list.scenarios.find((x) => (r.scenario ? x.relativePath === r.scenario : x.name === r.name))
              if (!s) return
              setOpenRun({ scenario: s.relativePath, runId: r.runId, n: Date.now() })
              open(s.relativePath)
            }}
          />
        ) : (
          <FileTree
            label={t('测试场景')}
            items={items}
            searching={!!q}
            // 树里只有一处选中：点了文件夹就只亮文件夹（右边仍是打开着的脚本），点脚本时清掉文件夹选中
            active={
              lib.activeFolder !== undefined && !recLeaf
                ? undefined
                : (recLeaf ?? (recording ? undefined : selected))?.relativePath.replace(/\.json$/i, '')
            }
            onOpen={(_p, s) => {
              // 录制中右边是录制界面：不能换去别的脚本，先停止
              if (recording)
                return h().toast.error(t('正在录制「{name}」：先停止或放弃再打开别的脚本', { name: rec?.name ?? '' }))
              lib.setActiveFolder(undefined)
              open(s.relativePath)
            }}
            // 录制中（含还没有文件的占位条目）不给脚本的右键菜单：改名、删除这些等录完再做
            onLeafMenu={(e, p, s) => (recording ? undefined : menus.leafMenu(e, p, s))}
            onFolderMenu={lib.folderMenu}
            // 搜索时只看命中的场景，空文件夹不掺进来
            folders={q ? undefined : lib.folders}
            activeFolder={lib.activeFolder}
            onFolderClick={lib.setActiveFolder}
            onMove={lib.onMove}
            // 拖进画布就是「调用脚本」（call 的 script 相对场景根、不带 .json）；按住 Alt 拖是插一份副本
            dragData={(s, e) =>
              s.relativePath === selected?.relativePath
                ? undefined
                : {
                    [GT_STEPS_MIME]: JSON.stringify([
                      { action: 'call', script: s.relativePath.replace(/\\/g, '/').replace(/\.json$/i, '') },
                    ]),
                    ...(e.altKey ? { [GT_COPY_MIME]: '1' } : {}),
                  }
            }
            leafIcon={(s) =>
              recording && rec?.name === s.name
                ? { icon: CircleDot, tone: 'ue:text-danger' }
                : { icon: FileJson, tone: s.parseError ? 'ue:text-danger' : 'ue:text-subtle' }
            }
            leafRight={(s) => {
              const r = lastOf(s)
              const marks = history[s.relativePath]
              return (
                <>
                  {(s.tags ?? []).includes('recorded') && (
                    <span className="ue:rounded-(--c-badge-radius) ue:bg-accent-soft ue:px-1.5 ue:text-accent-text">
                      {t('录制')}
                    </span>
                  )}
                  {/* Agent 写的脚本（场景 tags 带 agent，定稿 11）：和人录的分开，回归失败时先怀疑脚本 */}
                  {(s.tags ?? []).includes('agent') && (
                    <span className="ue:rounded-(--c-badge-radius) ue:bg-hover ue:px-1.5 ue:text-muted">
                      {t('Agent 编写')}
                    </span>
                  )}
                  {marks ? (
                    <GtHistoryBar marks={marks} />
                  ) : (
                    r &&
                    (r.succeeded ? (
                      <CircleCheck className="ue:h-3 ue:w-3 ue:text-success" />
                    ) : (
                      <CircleX className="ue:h-3 ue:w-3 ue:text-danger" />
                    ))
                  )}
                  <span className={cn(s.parseError && 'ue:text-danger')}>
                    {s.parseError ? t('解析失败') : t('{n} 步', { n: s.steps })}
                  </span>
                </>
              )
            }}
            folderRight={(leaves) => {
              // 最近一次失败的：有历史看历史的最新一次（跨编辑器会话），没有看本次会话的最近一次
              const failed = leaves.filter((s) =>
                history[s.relativePath] ? history[s.relativePath][0] === 'f' : lastOf(s)?.succeeded === false,
              ).length
              return (
                <>
                  {failed > 0 && <span className="ue:text-danger">{t('{n} 失败', { n: failed })}</span>}
                  <span>{leaves.length}</span>
                </>
              )
            }}
            empty={
              <p className="ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:leading-relaxed ue:text-subtle">
                {q
                  ? t('没有名字里带「{q}」的场景', { q: query })
                  : t('场景根里还没有场景：点搜索框旁的录制按钮录一个，或让 Agent 用 ue_gametest 写')}
              </p>
            }
          />
        )}
      </ListCol>
      <main className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:overflow-hidden">
        {state && !live && <GtOfflineBar />}
        {batch && !recording && (
          <GtBatchBar
            batch={batch}
            onOpen={(p) => open(p)}
            onStop={() => void stop()}
            onClose={() => setClosedBatch(batch.id)}
          />
        )}
        {recording && rec?.ask && (
          <GtKeyAsk
            key={`${rec.ask.step}`}
            project={project.id}
            ask={rec.ask}
            timeoutSec={rec.askTimeoutSec}
            onDone={() => undefined}
          />
        )}
        {recording && rec?.target === 'editor' ? (
          <GtEditorRecord
            status={rec}
            onDone={(saved) => {
              setRec(undefined)
              const dir = recordDir
              setRecordDir(undefined)
              if (!saved) return
              void (async () => {
                const at = dir === undefined ? saved : await lib.moveTo(saved, dir)
                reload()
                go('gametest', at)
              })()
            }}
          />
        ) : recording && rec ? (
          <GtRecord
            status={rec}
            gtVersion={gtVersion}
            linked={linked}
            onDone={(saved) => {
              setRec(undefined)
              shots.refresh()
              const dir = recordDir
              setRecordDir(undefined)
              if (!saved) return
              void (async () => {
                // 在某个文件夹里录的：挪过去再认截图里的字；录完直接打开录好的脚本
                const at = dir === undefined ? saved : await lib.moveTo(saved, dir)
                go('gametest', at)
                void ocrAfterRecord(project.id, list?.absoluteRootDir ?? '', at, reload)
              })()
            }}
          />
        ) : selected && list ? (
          <GtEditor
            key={selected.relativePath}
            project={project.id}
            root={list.absoluteRootDir ?? ''}
            scenario={selected}
            live={live}
            gtVersion={gtVersion}
            onSaved={reload}
            onDirty={onDirty}
            callers={callerCrumbs}
            onOpenCall={openCall}
            paletteHost={paletteHost}
            paletteQuery={q}
            onFolder={(f) => {
              setTab('scenarios')
              setQuery('')
              lib.setActiveFolder(f)
            }}
            more={moreItems}
            runExtra={live && !recording && !busy && !running ? runExtra(selected) : undefined}
            openRun={openRun?.scenario === selected.relativePath ? openRun : undefined}
            lastRun={lastOf(selected)}
            onRecordHere={
              segmentSupported(gtVersion) && !running && !busy
                ? (after) => startRecord({ scenario: selected.relativePath, after })
                : undefined
            }
            onRecord={
              live && !running && !recording && !busy ? () => startRecordIn(dirOf(selected.relativePath)) : undefined
            }
            onRun={
              live && !recording && !busy
                ? (from, extra) =>
                    void (from
                      ? runFrom(selected, from.doc as unknown as GtScenarioFile, { key: `steps.${from.index}` })
                      : runScenario(selected, false, extra))
                : undefined
            }
            run={
              running && job?.busy && !job.batch && job.name === selected.name
                ? { done: job.total, planned: job.planned ?? 0, failed: job.failed, onStop: () => void stop() }
                : undefined
            }
          />
        ) : list && !items.length && !q ? (
          <div className="ue:flex ue:flex-1 ue:flex-col ue:items-center ue:justify-center ue:gap-3 ue:p-8 ue:text-center">
            <FlaskConical className="ue:h-6 ue:w-6 ue:text-subtle" />
            <p className="ue:text-body ue:text-fg">{t('还没有测试脚本')}</p>
            <p className="ue:max-w-md ue:text-footnote ue:text-subtle">
              {t('新建一个脚本在画布上拖节点编写，或者在游戏里操作一遍录下来，也可以让 Agent 照着说明写')}
            </p>
            <div className="ue:flex ue:flex-wrap ue:justify-center ue:gap-2">
              <ui.Button size="sm" disabled={!list.absoluteRootDir} onClick={lib.newMenu}>
                <Plus className="ue:h-3.5 ue:w-3.5" />
                {t('新建脚本')}
              </ui.Button>
              <ui.Button
                size="sm"
                variant="secondary"
                title={needEditor || undefined}
                disabled={!live || running || !!busy}
                onClick={() => startRecordIn(undefined)}
              >
                <CircleDot className="ue:h-3.5 ue:w-3.5" />
                {t('录制')}
              </ui.Button>
              <ui.Button
                size="sm"
                variant="secondary"
                disabled={!list.absoluteRootDir}
                onClick={() => agentWrite.open('')}
              >
                <Sparkles className="ue:h-3.5 ue:w-3.5" />
                {t('让 Agent 写')}
              </ui.Button>
            </div>
          </div>
        ) : list ? (
          <div className="ue:flex ue:flex-1 ue:items-center ue:justify-center ue:p-8 ue:text-body ue:text-subtle">
            {t('在左边选一个脚本打开')}
          </div>
        ) : (
          <div className="ue:flex ue:flex-1 ue:items-center ue:justify-center ue:p-8 ue:text-subtle">
            <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
          </div>
        )}
      </main>
      {lib.dialogs}
      {agentWrite.dialog}
      {shots.dialog}
      {settings && (
        <GtSettings
          onClose={() => setSettings(false)}
          onOpenRules={() => {
            setSettings(false)
            setKeyRules(true)
          }}
        />
      )}
      {keyRules && list?.absoluteRootDir && (
        <GtKeyRulesPanel project={project.id} root={list.absoluteRootDir} onClose={() => setKeyRules(false)} />
      )}
      {apiLib && list?.absoluteRootDir && (
        <ApiLibrary project={project.id} root={list.absoluteRootDir} live={live} onClose={() => setApiLib(false)} />
      )}
      <Confirm
        open={!!switchTo}
        title={t('有改动没存')}
        okText={t('不存，打开那个')}
        danger
        onOk={() => {
          const p = switchTo
          setSwitchTo(undefined)
          dirty.current = false
          if (p) go('gametest', p)
        }}
        onCancel={() => setSwitchTo(undefined)}
      >
        <p className="ue:text-footnote ue:text-fg">{t('打开别的脚本，这次的改动就丢了。要留着就先点「保存」。')}</p>
      </Confirm>
      <Confirm
        open={asking}
        title={t('开始录制')}
        okText={t('开始录制')}
        onOk={() => startRecord()}
        onCancel={() => {
          setAsking(false)
          setRecordDir(undefined)
        }}
      >
        <div className="ue:flex ue:flex-col ue:gap-2">
          <ui.Input
            autoFocus
            value={recName}
            placeholder={recDefault}
            onChange={(e: { target: { value: string } }) => setRecName(e.target.value)}
          />
          {recNameError && <p className="ue:text-footnote ue:text-danger">{recNameError}</p>}
          {editorRecordSupported(gtVersion) && (
            <ui.Segmented
              size="sm"
              label={t('录什么')}
              value={recTarget}
              onChange={setRecTarget}
              options={[
                { id: 'game' as const, label: t('游戏') },
                { id: 'editor' as const, label: t('编辑器') },
              ]}
            />
          )}
          {recTarget === 'editor' && editorRecordSupported(gtVersion) ? (
            <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">
              {EDITOR_RECORD_HELP()}
              {recordDir !== undefined && ` ${t('录完挪进 {p}/。', { p: recordDir })}`}
            </p>
          ) : (
            <>
              <label className="ue:flex ue:cursor-pointer ue:items-start ue:gap-2 ue:text-footnote ue:text-fg">
                <input
                  type="checkbox"
                  className="ue:mt-0.5 ue:accent-(--accent)"
                  checked={keepPace}
                  onChange={(e) => setKeepPace(e.target.checked)}
                />
                <span className="ue:flex ue:flex-col ue:gap-0.5">
                  {t('保留节奏')}
                  <span className="ue:text-subtle">
                    {t('点界面之间的停顿也录成等待，原样复现手速。默认不录：回放时点击、输入会自己等控件可以操作')}
                  </span>
                </span>
              </label>
              <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">
                {t(
                  'PIE 没开时会先开 PIE。之后在游戏窗口里正常操作：点控件录成对这个控件的点击（不看控件类，谁接住了就录谁），在输入框里打字录成输入，点在游戏画面上和按键录成真实按键。按住 Ctrl+Alt 点一个控件录成断言。停止后存到场景根下的 recorded/。',
                )}
                {recordDir !== undefined && ` ${t('录完挪进 {p}/。', { p: recordDir })}`}
              </p>
              {handlerSource === 'hitPath' && <HitPathNote />}
            </>
          )}
        </div>
      </Confirm>
    </div>
  )
}

function RunList({
  runs,
  offline,
  onOpen,
  onMenu,
}: {
  runs: GtRunSummary[]
  /** 编辑器没连上：列的是产物目录里最近的报告，不是「这次启动后」的 */
  offline: boolean
  onOpen: (r: GtRunSummary) => void
  onMenu: (e: React.MouseEvent, r: GtRunSummary) => void
}) {
  if (!runs.length)
    return (
      <p className="ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
        {offline ? t('产物目录里还没有运行报告') : t('编辑器这次启动后还没跑过测试')}
      </p>
    )
  return (
    <div className="ue:flex ue:flex-col ue:gap-px">
      {[...runs].reverse().map((r) => (
        <button
          key={r.runId}
          type="button"
          onClick={() => onOpen(r)}
          onContextMenu={(e) => onMenu(e, r)}
          className="ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-(--c-row-radius) ue:px-2 ue:text-left ue:text-body ue:text-fg ue:hover:bg-sel/60"
        >
          {r.succeeded ? (
            <CircleCheck className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-success" />
          ) : (
            <CircleX className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-danger" />
          )}
          <span className="ue:min-w-0 ue:flex-1 ue:truncate">{r.name}</span>
          <span className="ue:shrink-0 ue:text-caption ue:text-subtle ue:tabular-nums">
            {r.startedAtUtc ? runTime(r.startedAtUtc) : ''}
          </span>
        </button>
      ))}
    </div>
  )
}

/** 今天跑的只写时间；磁盘上读的可能是几天前的，带上日期 */
function runTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString() : d.toLocaleString()
}
