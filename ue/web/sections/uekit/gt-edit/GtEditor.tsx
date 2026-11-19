import {
  CircleCheck,
  CircleX,
  Copy,
  Download,
  Loader2,
  ScanSearch,
  Sparkles,
  TriangleAlert,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  getAt,
  isBlock,
  type GtPath,
  type GtScript,
  type GtStep,
} from '../../../../shared/gt-script/index.ts'
import { op, ppost } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { ErrorText, fmtTime } from '../../../ui.tsx'
import type { MenuItem } from '../../../menu.tsx'
import { PANE_FIXED, SplitHandle, usePane } from '../../../split.tsx'
import { useApis } from '../gt-api/model.ts'
import { RunControls } from '../gt-debug/RunControls.tsx'
import { RunPanel } from '../gt-debug/RunPanel.tsx'
import { RunParams } from '../gt-debug/RunParams.tsx'
import { useDebug } from '../gt-debug/use-debug.ts'
import { stepKey } from '../gt-flow/layout.ts'
import { guardsSupported, GUARD_MIN_VERSION } from '../gt-guards/model.ts'
import type { CmdCtx } from './commands.ts'
import { EditContext } from './ctx.ts'
import { EditorHeader } from './EditorHeader.tsx'
import { Inspector } from './Inspector.tsx'
import { useRecordHere } from './record-here.ts'
import { useTidyHere } from './tidy-here.ts'
import { PaletteGrid } from './rail/PaletteGrid.tsx'
import { useSelectorCheck } from './selector-check.tsx'
import { copyScenarioJson, downloadScenarioJson } from '../gt-export.ts'
import type { GtHistoryRun } from '../gt-step-history.ts'
import { GtStepHistory } from '../GtStepHistory.tsx'
import type { GtRunSummary } from '../gt-run/types.ts'
import { RunBanner, type EditRun } from './RunBanner.tsx'
import { ScriptSettings } from './ScriptSettings.tsx'
import { useScript } from './use-script.ts'
import { allViews } from './views.ts'

/** 编辑页记住上次用的视图（每个人自己的习惯，存浏览器） */
const VIEW_KEY = 'ue.gt.editView'
const readView = () => {
  try {
    // 默认流程图（定稿第 9 节、效果图 1）；用过别的视图就记住
    return localStorage.getItem(VIEW_KEY) ?? 'flow'
  } catch {
    return 'flow'
  }
}

/** 场景库里的一项（GameTest 页的场景列表） */
export interface EditScenario {
  name: string
  relativePath: string
  steps: number
  tags?: string[]
  revision?: number
}

/**
 * 场景编辑页（定稿第 9 节、效果图 1）：进 GameTest 就是它（2026-11-19 起没有单独的运行结果页）。
 * 上面一条顶栏（面包屑、编写 / 录制、视图切换、目标、保存、⋯、试节点、运行），中间是视图（左上角一枚上次运行的结果），
 * 右栏「检查器 / 运行」两页、能拖边调宽并记住；场景库和节点面板在 UE 页的二级栏里（节点面板由 GameTest 页给一个位置，
 * 这里用 portal 画进去，和画布共用同一份脚本）。在跑这个脚本时顶栏下面多一条运行横条。
 * 视图来自视图注册表，块的样子来自块 UI 注册表，节点面板来自面板格子注册表，这里只管把它们拼起来、读写文件
 */
export function GtEditor({
  project,
  root,
  scenario,
  live,
  gtVersion,
  onSaved,
  onRecord,
  onRecordHere,
  onRun,
  run,
  paletteHost,
  paletteQuery = '',
  onFolder,
  more = [],
  runExtra,
  openRun,
  lastRun,
  onDirty,
}: {
  project: string
  /** 场景根的绝对路径 */
  root: string
  scenario: EditScenario
  live: boolean
  gtVersion?: string
  onSaved: () => void
  /** 开始录制（录成新脚本，放在这个脚本的文件夹里） */
  onRecord?: () => void
  /** 从选中这一步后面接着录（GameTest 1.10.0）：after 是步骤 id；不给时菜单项灰掉 */
  onRecordHere?: (after?: string) => Promise<void> | void
  /**
   * 跑这个脚本：不给 from 跑整个文件，给了就用编辑中的数据从第 index 步跑到底（旧版 GameTest 用）；
   * extra 是调试参数（params、from / to 步骤 id、breakpoints），并进 gt.run
   */
  onRun?: (from?: { doc: GtScript; index: number }, extra?: Record<string, unknown>) => void
  /** 正在跑这个脚本时的进度 */
  run?: EditRun
  /** 二级栏「节点」页签给的位置：节点面板画进去 */
  paletteHost?: HTMLElement | null
  /** 二级栏的搜索词（节点页签时筛节点） */
  paletteQuery?: string
  /** 面包屑里点了文件夹 */
  onFolder?: (folder: string) => void
  /** 顶栏「⋯」里接在后面的（运行设置、接口库、条目规则） */
  more?: (MenuItem | false | undefined)[]
  /** 「运行」下拉里接在后面的（全部照做、批量运行） */
  runExtra?: (MenuItem | false | undefined)[]
  /** 左栏「最近运行」里点的那次：右栏切到运行面板看它的报告 */
  openRun?: { runId: string; n: number }
  /** 这个脚本最近一次运行（画布左上角的结果） */
  lastRun?: GtRunSummary
  /** 有没有没存的改动（换脚本前外面要先问一句） */
  onDirty?: (dirty: boolean) => void
}) {
  const { ui } = h()
  const s = useScript({ project, root, path: scenario.relativePath })
  const apis = useApis(project, root, live)
  const [aliases, setAliases] = useState<string[]>([])
  const [view, setView] = useState(readView)
  // 右栏在「运行」页（开跑时、左栏点了某次运行时自动切过来，跑完留着看报告）
  const [panel, setPanel] = useState(!!openRun)
  const views = allViews()
  const View = (views.find((v) => v.id === view) ?? views[0]).Component
  // 右栏宽度：拖边调整，记在本机（用户 2026-11-19：分栏都能拖、记住）
  const aside = usePane('gt-edit-aside', '380px', 300)
  const asideRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (openRun) setPanel(true)
  }, [openRun])
  useEffect(() => onDirty?.(s.dirty), [s.dirty, onDirty])
  // 画布左上角「看报告」点的那次（每点一次 n 换一个，同一次再点也切过来）
  const [reportReq, setReportReq] = useState<{ runId: string; n: number }>()

  useEffect(() => {
    void ppost<{ vars: Record<string, unknown> }>(project, 'ext/gt/aliases', { root })
      .then((r) => setAliases(Object.keys(r.vars)))
      .catch(() => setAliases([]))
  }, [project, root])

  const tryStep = useCallback(
    async (path: GtPath) => {
      const step = s.doc && (getAt(s.doc, path) as GtStep | undefined)
      if (!step) return
      try {
        const r = await op<{ ok?: boolean; succeeded?: boolean; message?: string; runId?: string }>(
          project,
          'gt.step',
          {
            step,
            ...(s.doc?.vars ? { vars: s.doc.vars } : {}),
          },
        )
        if (r.runId) h().toast.success(t('块在后台跑了，结果看「最近运行」'))
        else if (r.ok === false || r.succeeded === false) h().toast.error(r.message || t('这一步没通过'))
        else h().toast.success(r.message || t('这一步通过了'))
      } catch (e) {
        h().toast.error((e as Error).message)
      }
    },
    [project, s.doc],
  )

  const save = async () => {
    await s.save()
    onSaved()
  }
  const setViewKept = (v: string) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // 存不了就每次从流程图开始
    }
  }
  const old = !!gtVersion && !guardsSupported(gtVersion)
  // 跑之前先存盘：UE 跑的是磁盘上的文件（断点、从哪到哪按步骤 id，存了才有 id）
  const debug = useDebug({
    project,
    root,
    scenario: scenario.relativePath,
    doc: s.doc,
    start:
      onRun &&
      ((extra) =>
        void (async () => {
          if (s.dirty) await save()
          onRun(undefined, extra)
        })()),
  })
  useEffect(() => {
    if (debug.flow.active) setPanel(true)
  }, [debug.flow.active])
  // 这个脚本最近 10 次运行（gt.history，跨编辑器会话）：运行面板的「历史」页、检查器里这一步的「最近几次」；
  // 旧 GameTest 没有这个操作时是 undefined。跑完一次（lastRun 换了）重拉
  const [history, setHistory] = useState<GtHistoryRun[]>()
  useEffect(() => {
    let off = false
    op<{ runs?: GtHistoryRun[] }>(project, 'gt.history', {
      scenario: scenario.relativePath,
      ...(live ? {} : { disk: true }),
    }).then(
      (r) => !off && setHistory(r.runs ?? []),
      () => !off && setHistory(undefined),
    )
    return () => {
      off = true
    }
  }, [project, scenario.relativePath, live, lastRun?.runId])
  const sel = s.selected.length === 1 ? s.selected[0] : undefined
  const selStep = sel && s.doc && (getAt(s.doc, sel) as GtStep | undefined)
  const selKey = selStep && typeof selStep === 'object' ? stepKey(selStep, sel!) : undefined
  const topIndex = sel && sel.length === 2 && sel[0] === 'steps' && typeof sel[1] === 'number' ? sel[1] : undefined
  // 旧版 GameTest 不认 gt.run 的 from：用编辑中的数据从主流程第几步跑（只能选主流程的步）
  const runFrom =
    !onRun || run
      ? undefined
      : old
        ? topIndex !== undefined && s.doc
          ? () => onRun({ doc: s.doc!, index: topIndex })
          : undefined
        : selKey && debug.run
          ? () => debug.run?.({ from: selKey })
          : undefined

  // 整页快捷键：输入框里也要能 Ctrl+S；撤销重做在输入框里交给输入框自己
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')
      if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (s.dirty && !s.saving) void save()
      } else if (!typing && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (!typing && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        s.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onTry = live ? (p: GtPath) => void tryStep(p) : undefined
  const onRecordHereAt = useRecordHere(s, onSaved, live ? onRecordHere : undefined)
  const tidyHere = useTidyHere(s, { project, root, path: scenario.relativePath, name: scenario.name, onSaved })
  const cmdCtx: CmdCtx | undefined = s.doc && {
    doc: s.doc,
    selected: s.selected,
    apply: s.apply,
    select: s.select,
    onTry,
    onRecordHere: onRecordHereAt,
    onTidy: tidyHere.onTidy,
  }
  const steps = (s.doc?.steps ?? []) as GtStep[]
  const hasBlocks = steps.some((x) => isBlock(x))
  const check = useSelectorCheck(project, s.doc, (p) => s.select([p]))
  const { tidy } = tidyHere
  const moreItems: (MenuItem | false | undefined)[] = [
    {
      label: t('整理成流程'),
      icon: Sparkles,
      onClick: () => tidy.ask(),
    },
    tidy.hasBackup && { label: t('恢复成原录制'), icon: Undo2, hint: t('整理前的备份'), onClick: tidy.restore },
    {
      label: t('核对选择器'),
      icon: check.checking ? Loader2 : ScanSearch,
      hint: live ? t('只解析，不执行') : t('要先启动编辑器'),
      disabled: !live || check.checking,
      onClick: check.start,
    },
    'sep' as const,
    {
      label: t('复制为 JSON'),
      icon: Copy,
      onClick: () => copyScenarioJson(project, root, scenario.relativePath),
    },
    {
      label: t('导出 JSON'),
      icon: Download,
      onClick: () => downloadScenarioJson(project, root, scenario.relativePath),
    },
    more.some(Boolean) && ('sep' as const),
    ...more,
  ]
  const historyOf = (p: GtPath) =>
    history && (
      <GtStepHistory
        runs={history}
        row={{ key: p.join('.'), slot: p.slice(0, -1).join('.'), i: Number(p[p.length - 1]) }}
        hasBlocks={hasBlocks}
        revision={scenario.revision}
      />
    )

  return (
    <EditContext.Provider
      value={{ project, root, path: scenario.relativePath, live, doc: s.doc, apis: apis.items, aliases }}
    >
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
        <EditorHeader
          name={scenario.name}
          folder={scenario.relativePath.split('/').slice(0, -1).join('/')}
          recorded={(scenario.tags ?? []).includes('recorded')}
          onFolder={onFolder}
          more={moreItems}
          runExtra={runExtra}
          views={views}
          view={view}
          onView={setViewKept}
          onRecord={onRecord}
          dirty={s.dirty}
          saving={s.saving}
          onSave={() => void save()}
          onTry={onTry && sel ? () => onTry(sel) : undefined}
          onRun={debug.run && !run ? () => debug.run?.() : undefined}
          onRunFrom={runFrom}
          onRunTo={!old && !run && selKey && debug.run ? () => debug.run?.({ to: selKey }) : undefined}
          running={!!run}
        />
        {run && (
          <RunBanner run={run} paused={debug.flow.paused}>
            {!old && <RunControls debug={debug} />}
          </RunBanner>
        )}
        {old && (
          <p className="ue:flex ue:items-center ue:gap-1.5 ue:border-b ue:border-line ue:bg-warning/8 ue:px-4 ue:py-1.5 ue:text-footnote ue:text-warning">
            <TriangleAlert className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
            {t('装着的 GameTest {v} 还不认块、条件和守护：可以先编辑，跑之前到「UE 插件」页升级到 {m} 以上', {
              v: gtVersion,
              m: GUARD_MIN_VERSION,
            })}
          </p>
        )}
        {check.banner}
        {s.error ? (
          <div className="ue:p-4">
            <ErrorText>{s.error}</ErrorText>
          </div>
        ) : !s.doc ? (
          <div className="ue:flex ue:justify-center ue:p-8 ue:text-subtle">
            <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
          </div>
        ) : (
          <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto ue:lg:flex-row ue:lg:overflow-hidden">
            <section className="ue:relative ue:flex ue:min-h-[50vh] ue:min-w-0 ue:flex-col ue:lg:min-h-0 ue:lg:flex-1">
              <View
                doc={s.doc}
                onChange={s.apply}
                selected={s.selected}
                onSelect={s.select}
                onTry={onTry}
                history={{ undo: s.undo, redo: s.redo, canUndo: s.canUndo, canRedo: s.canRedo }}
              />
              {lastRun && !run && (
                <LastRunChip
                  run={lastRun}
                  onOpen={() => {
                    setPanel(true)
                    setReportReq({ runId: lastRun.runId, n: Date.now() })
                  }}
                />
              )}
            </section>
            <aside
              ref={asideRef}
              style={aside.style('60%')}
              className={`ue:relative ue:flex ue:min-h-0 ue:flex-col ue:border-t ue:border-line ue:lg:border-t-0 ue:lg:border-l ${PANE_FIXED}`}
            >
              <div className="ue:absolute ue:inset-y-0 ue:left-0 ue:z-10 ue:hidden ue:lg:block">
                <SplitHandle pane={aside} paneRef={asideRef} side="right" reserve={() => 480} />
              </div>
              <div className="ue:flex ue:shrink-0 ue:items-center ue:border-b ue:border-line ue:px-3 ue:py-2">
                <ui.Segmented
                  size="sm"
                  fill
                  label={t('检查器 / 运行')}
                  value={panel ? 'run' : 'inspect'}
                  onChange={(v: string) => setPanel(v === 'run')}
                  options={[
                    { id: 'inspect', label: t('检查器') },
                    { id: 'run', label: debug.flow.active ? t('运行中') : t('运行') },
                  ]}
                />
              </div>
              <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
                {panel ? (
                  <RunPanel
                    project={project}
                    doc={s.doc}
                    debug={debug}
                    onSelect={(p) => s.select([p])}
                    onClose={() => setPanel(false)}
                    history={history}
                    open={reportReq ?? openRun}
                    disk={!live}
                  />
                ) : s.selected.length && cmdCtx ? (
                  <Inspector
                    doc={s.doc}
                    selected={s.selected}
                    onChange={s.apply}
                    ctx={cmdCtx}
                    onTry={onTry}
                    history={historyOf}
                  />
                ) : (
                  <ScriptSettings doc={s.doc} onChange={(d) => s.apply(d)} />
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
      {paletteHost &&
        s.doc &&
        createPortal(
          <PaletteGrid doc={s.doc} selected={s.selected} onChange={s.apply} onSelect={s.select} q={paletteQuery} />,
          paletteHost,
        )}
      {debug.pending && s.doc && (
        <RunParams
          doc={s.doc}
          scenario={scenario.relativePath}
          onRun={debug.confirmParams}
          onCancel={debug.cancelParams}
        />
      )}
      {tidyHere.dialogs}
    </EditContext.Provider>
  )
}

/** 画布左上角：这个脚本上次运行的结果（原来运行结果页的头一眼），点「看报告」右栏切到运行面板 */
function LastRunChip({ run, onOpen }: { run: GtRunSummary; onOpen: () => void }) {
  const { cn } = h()
  return (
    <div className="ue:absolute ue:top-3 ue:left-3 ue:z-10 ue:flex ue:h-8 ue:items-center ue:gap-2 ue:rounded-xl ue:bg-card ue:px-2.5 ue:text-footnote ue:shadow-pop">
      {run.succeeded ? (
        <CircleCheck className="ue:h-3.5 ue:w-3.5 ue:text-success" />
      ) : (
        <CircleX className="ue:h-3.5 ue:w-3.5 ue:text-danger" />
      )}
      <span className={cn(run.succeeded ? 'ue:text-fg' : 'ue:text-danger')}>
        {run.succeeded ? t('上次运行通过') : t('上次运行失败')}
      </span>
      {run.startedAtUtc && <span className="ue:text-subtle">{fmtTime(run.startedAtUtc)}</span>}
      <button type="button" onClick={onOpen} className="ue:cursor-pointer ue:text-accent ue:hover:underline">
        {t('看报告')}
      </button>
    </div>
  )
}
