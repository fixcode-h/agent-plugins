import { CircleCheck, CircleDot, CircleX, FileJson, FlaskConical, Loader2, Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { MenuHost } from '../../menu.tsx'
import { Confirm, ErrorText, NotRunning } from '../../ui.tsx'
import { useScenarioMenus, type Scenario } from './GtMenus.tsx'
import { GtRecord, type RecordStatus } from './GtRecord.tsx'
import { GtRun, type GtJob, type GtRunSummary, type GtScenarioFile } from './GtRun.tsx'
import { ListCol, useExtEvents } from './ListCol.tsx'
import { NotInstalled } from './NotInstalled.tsx'
import { FileTree, type TreeLeaf } from './tree.tsx'

/**
 * GameTest 页（UEKit 扩展，效果图 designs/UEKit-扩展页面-效果图/3–5）：左边场景树（和表格页一样的文件树），
 * 右边是选中场景最近一次 run 的步骤和每步详情；运行中、录制中的状态靠推送事件（gt.job、gt.record）更新，不轮询。
 * 跑测试要 UE 编辑器开着（PIE 由场景自己的 pie.start 步骤起）。
 */
interface ScenarioList {
  scenarios: Scenario[]
  rootDir: string
  /** 场景根的绝对路径：面板按它直接读写场景文件 */
  absoluteRootDir?: string
}

export function GameTest() {
  const { project, state, sub, go } = useUe()
  const { ui, cn } = h()
  const { busy, run } = useAction()
  const installed = state?.extensions?.some((x) => x.name === 'GameTest')
  const live = (state?.instances ?? []).some((i) => i.kind === 'editor' && i.online)
  const [list, setList] = useState<ScenarioList>()
  const [runs, setRuns] = useState<GtRunSummary[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'scenarios' | 'runs'>('scenarios')
  const [job, setJob] = useState<GtJob>()
  const [rec, setRec] = useState<RecordStatus>()
  const [asking, setAsking] = useState(false)
  const [recName, setRecName] = useState('')
  // 从第几步开始跑的（「从这一步开始运行」）：结果的 index 加上它才对得上场景里的行；只在这次打开页面里记
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  // 推送里已经结束的 run：第一步就失败的 run 在 gt.run 返回之前就推了「结束」，返回后不能再标成运行中
  const finished = useRef(new Set<string>())

  const reload = () => {
    op<ScenarioList>(project.id, 'gt.scenarios', { limit: 1000 })
      .then((r) => {
        setList(r)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
    void op<{ runs: GtRunSummary[] }>(project.id, 'gt.runs')
      .then((r) => setRuns(r.runs ?? []))
      .catch(() => undefined)
  }
  useEffect(() => {
    if (!installed || !live) return
    reload()
    void op<GtJob>(project.id, 'gt.job', { steps: 200 })
      .then((j) => j.busy && setJob(j))
      .catch(() => undefined)
    void op<RecordStatus>(project.id, 'gt.record.status', { last: 20 })
      .then((r) => r.recording && setRec(r))
      .catch(() => undefined)
    // 换项目、编辑器起来时重拉；reload 每次渲染都是新函数
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, installed, live])

  useExtEvents(project.id, (e) => {
    if (e.event === 'gt.job') {
      const j = e as unknown as GtJob & { phase?: string; lastStep?: GtJob['steps'][number] }
      setJob((old) => {
        // 事件不带全部步骤，只带最新一步：接到已有的列表后面
        const steps = old?.runId === j.runId ? [...(old?.steps ?? [])] : []
        if (j.lastStep && !steps.some((s) => s.index === j.lastStep!.index)) steps.push(j.lastStep)
        return { ...j, steps }
      })
      if (j.phase === 'finished') {
        if (j.runId) finished.current.add(j.runId)
        reload()
      }
    } else if (e.event === 'gt.record') {
      const r = e as unknown as RecordStatus & { phase?: string }
      setRec((old) => ({
        ...r,
        last: r.phase === 'started' ? [] : [...(old?.last ?? []), ...(r.last ?? [])].slice(-200),
      }))
      if (r.phase === 'stopped') reload()
    }
  })

  const lastRun = useMemo(() => {
    const m = new Map<string, GtRunSummary>()
    for (const r of runs)
      if (!m.has(r.name) || (r.startedAtUtc ?? '') > (m.get(r.name)!.startedAtUtc ?? '')) m.set(r.name, r)
    return m
  }, [runs])
  const q = query.trim().toLowerCase()
  const items: TreeLeaf<Scenario>[] = useMemo(
    () =>
      (list?.scenarios ?? [])
        .filter((s) => !q || `${s.name} ${s.relativePath} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(q))
        .map((s) => ({ path: s.relativePath.replace(/\.json$/i, ''), data: s })),
    [list, q],
  )

  const selected = list?.scenarios.find((s) => s.relativePath === sub)
  // 已经出现在最近运行里的 run 一定跑完了：推送丢了、页面晚连上时也不会一直停在「运行中」
  const running = !!job?.busy && !runs.some((r) => r.runId === job.runId)
  const recording = !!rec?.recording
  /** 开跑：gt.run 里 UE 会立刻推进一次，第一步就失败的 run 返回时已经结束（finished），这时不再标成运行中 */
  const startRun = (name: string, args: Record<string, unknown>, offset: number) =>
    run('run', async () => {
      const r = await op<{ runId: string; steps: number; finished?: boolean }>(project.id, 'gt.run', args)
      setOffsets((o) => ({ ...o, [r.runId]: offset }))
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
  const runScenario = (s: Scenario) => startRun(s.name, { scenario: s.relativePath }, 0)
  const runFrom = (s: Scenario, file: GtScenarioFile, i: number) =>
    startRun(s.name, { name: s.name, steps: file.steps.slice(i), stepDelayMs: file.stepDelayMs }, i)
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
  const menus = useScenarioMenus({
    project: project.id,
    root: list?.absoluteRootDir ?? '',
    rootLabel: list?.rootDir ?? '',
    locked: running || recording || !!busy,
    reload,
    open: (s) => go('gametest', s.relativePath),
    runScenario,
    scenarios: list?.scenarios ?? [],
  })
  const startRecord = () =>
    run('record', async () => {
      setAsking(false)
      const r = await op<RecordStatus>(project.id, 'gt.record.start', { name: recName.trim() || t('新录制') })
      setRec({ ...r, last: [] })
    })

  if (state && !installed) return <NotInstalled name="GameTest" />
  if (state && !live)
    return <NotRunning icon={FlaskConical} what={t('GameTest 在编辑器里跑测试场景：先启动编辑器，场景会自己开 PIE')} />

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto ue:md:flex-row ue:md:overflow-hidden">
      <ListCol
        id="gametest"
        title="GameTest"
        count={list?.scenarios.length ?? '…'}
        query={query}
        onQuery={setQuery}
        placeholder={t('按名字找场景')}
        extra={
          <>
            <ui.IconButton
              icon={CircleDot}
              size="sm"
              label={t('录制：在游戏窗口里操作一遍，录成场景')}
              disabled={recording || running || !!busy}
              onClick={() => setAsking(true)}
            />
            <ui.Button
              size="sm"
              disabled={!selected || running || recording || !!busy}
              onClick={() => selected && runScenario(selected)}
            >
              <Play className="ue:h-3.5 ue:w-3.5" /> {t('运行')}
            </ui.Button>
          </>
        }
        tabs={
          <ui.Segmented
            size="sm"
            fill
            label={t('场景 / 最近运行')}
            value={tab}
            onChange={setTab}
            options={[
              { id: 'scenarios', label: t('场景') },
              { id: 'runs', label: `${t('最近运行')} ${runs.length}` },
            ]}
          />
        }
        footer={
          <span>
            {t('场景根')} <code className="ue:font-mono ue:text-muted">{list?.rootDir || '…'}</code>
          </span>
        }
      >
        {error ? (
          <ErrorText>{error}</ErrorText>
        ) : !list ? (
          <div className="ue:flex ue:justify-center ue:p-6 ue:text-subtle">
            <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
          </div>
        ) : tab === 'runs' ? (
          <RunList
            runs={runs}
            onMenu={menus.runMenu}
            onOpen={(r) => {
              const s = list.scenarios.find((x) => x.name === r.name)
              if (s) go('gametest', s.relativePath)
            }}
          />
        ) : (
          <FileTree
            label={t('测试场景')}
            items={items}
            searching={!!q}
            active={selected?.relativePath.replace(/\.json$/i, '')}
            onOpen={(_p, s) => go('gametest', s.relativePath)}
            onLeafMenu={menus.leafMenu}
            onFolderMenu={menus.folderMenu}
            leafIcon={(s) =>
              recording && rec?.name === s.name
                ? { icon: CircleDot, tone: 'ue:text-danger' }
                : { icon: FileJson, tone: s.parseError ? 'ue:text-danger' : 'ue:text-subtle' }
            }
            leafRight={(s) => {
              const r = lastRun.get(s.name)
              return (
                <>
                  {(s.tags ?? []).includes('recorded') && (
                    <span className="ue:rounded-(--c-badge-radius) ue:bg-accent-soft ue:px-1.5 ue:text-accent-text">
                      {t('录制')}
                    </span>
                  )}
                  {r &&
                    (r.succeeded ? (
                      <CircleCheck className="ue:h-3 ue:w-3 ue:text-success" />
                    ) : (
                      <CircleX className="ue:h-3 ue:w-3 ue:text-danger" />
                    ))}
                  <span className={cn(s.parseError && 'ue:text-danger')}>
                    {s.parseError ? t('解析失败') : t('{n} 步', { n: s.steps })}
                  </span>
                </>
              )
            }}
            folderRight={(leaves) => {
              const failed = leaves.filter((s) => lastRun.get(s.name)?.succeeded === false).length
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
                  : t('场景根里还没有场景：点右上角的录制按钮录一个，或让 Agent 用 ue_gametest 写')}
              </p>
            }
          />
        )}
      </ListCol>
      <main className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:overflow-hidden">
        {recording && rec ? (
          <GtRecord status={rec} onDone={() => setRec(undefined)} />
        ) : selected ? (
          <GtRun
            key={selected.relativePath}
            scenario={selected}
            root={list?.absoluteRootDir ?? ''}
            job={running && job?.name === selected.name ? job : undefined}
            last={lastRun.get(selected.name)}
            offset={offsets[(running ? job?.runId : lastRun.get(selected.name)?.runId) ?? ''] ?? 0}
            onStop={() => void stop()}
            onRunFrom={running || recording ? undefined : (file, i) => void runFrom(selected, file, i)}
          />
        ) : (
          <div className="ue:flex ue:flex-1 ue:flex-col ue:items-center ue:justify-center ue:gap-2 ue:p-8 ue:text-center ue:text-footnote ue:text-subtle">
            <FlaskConical className="ue:h-6 ue:w-6" />
            {t('选左边的一个场景，看最近一次运行的每一步')}
          </div>
        )}
      </main>
      {menus.dialogs}
      <MenuHost />
      <Confirm
        open={asking}
        title={t('开始录制')}
        okText={t('开始录制')}
        onOk={startRecord}
        onCancel={() => setAsking(false)}
      >
        <div className="ue:flex ue:flex-col ue:gap-2">
          <ui.Input
            autoFocus
            value={recName}
            placeholder={t('场景名，例如 新手引导')}
            onChange={(e: { target: { value: string } }) => setRecName(e.target.value)}
          />
          <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">
            {t(
              'PIE 没开时会先开 PIE。之后在游戏窗口里正常操作：点控件录成选择器，按键录成真实按键，停顿录成等待。停止后存到场景根下的 recorded/。',
            )}
          </p>
        </div>
      </Confirm>
    </div>
  )
}

function RunList({
  runs,
  onOpen,
  onMenu,
}: {
  runs: GtRunSummary[]
  onOpen: (r: GtRunSummary) => void
  onMenu: (e: React.MouseEvent, r: GtRunSummary) => void
}) {
  if (!runs.length)
    return (
      <p className="ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
        {t('编辑器这次启动后还没跑过测试')}
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
            {r.startedAtUtc ? new Date(r.startedAtUtc).toLocaleTimeString() : ''}
          </span>
        </button>
      ))}
    </div>
  )
}
