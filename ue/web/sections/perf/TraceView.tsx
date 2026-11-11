import { Maximize2, MessageSquare } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { SplitHandle, usePane } from '../../split.tsx'
import { ErrorText, LinkBtn, Note } from '../../ui.tsx'
import { FrameStrip } from './FrameStrip.tsx'
import { Empty, Section, Skeleton, Tabs, fmtAt, fmtMs } from './parts.tsx'
import { StatsBar, type StatItem } from './StatsBar.tsx'
import { Timeline } from './Timeline.tsx'
import { ZoomControls } from './ZoomControls.tsx'
import { TimersTable } from './TimersTable.tsx'
import { Counters, TraceLog } from './TraceExtras.tsx'
import { CallTree, InstancesView, StackView, type PanelActions } from './TracePanels.tsx'
import {
  orderLanes,
  traceQuery,
  useDebounced,
  useTraceInfo,
  type Bookmark,
  type PickedBlock,
  type Range,
  type Timing,
  type TraceBase,
  type TraceFrames,
} from './trace.ts'
import type { Capture } from './types.ts'

/** stat unit 的默认阈值（t.TargetFrameTimeThreshold / t.UnacceptableFrameTimeThreshold），trace 里读不到项目改过的值 */
const BUDGET = { target: 33.9, unacceptable: 50 }

/**
 * 一份 trace 的详情（性能页设计 4、效果图 2）：顶上摘要读数条，下面帧条（拖选分析范围）、时间轴（函数调用堆栈），
 * 右栏上半是计时器 / 计数器 / 日志，下半是选中计时器的调用者 / 被调用者（上下两棵树，照 Insights）、点中块的调用堆栈、计时器的每次调用。
 * 分析范围（帧条拖选、时间轴刻度条拖选、双击一块）一变，摘要、计时器、调用树、计数器、日志都只算这一段。
 * 第一次打开要等编辑器（或后台编辑器）用 TraceServices 分析完，分析中显示进度。
 */
export function TraceView({ capture, onAgent }: { capture: Capture; onAgent?: (extra: string) => void }) {
  const { project } = useUe()
  const { info, error, ready } = useTraceInfo(project.id, capture.id)
  if (error)
    return (
      <div className="ue:p-5">
        <ErrorText>{error}</ErrorText>
      </div>
    )
  if (!ready)
    return (
      <div className="ue:flex ue:flex-col ue:p-5">
        <Skeleton
          rows={5}
          note={
            info
              ? t('正在分析 trace（已分析到第 {s} 秒）…', { s: info.duration.toFixed(1) })
              : t('正在分析 trace…第一次要启动后台编辑器，可能要一两分钟（编辑器开着时用编辑器分析，快得多）')
          }
        />
      </div>
    )
  return <TraceBody capture={capture} duration={info!.duration} threads={info!.threads} onAgent={onAgent} />
}

function TraceBody({
  capture,
  duration,
  threads,
  onAgent,
}: {
  capture: Capture
  duration: number
  threads: { id: number; name: string; group: string }[]
  onAgent?: (extra: string) => void
}) {
  const { project } = useUe()
  const id = capture.id
  const [range, setRange] = useState<Range>()
  const [view, setViewState] = useState<Range>(() => ({ t0: 0, t1: Math.min(duration, 0.1) }))
  const setView = useCallback((r: Range) => setViewState(r), [])
  // 帧条自己的缩放窗口（和时间轴的 view 分开）：默认整段，换了 trace 回到整段
  const [strip, setStrip] = useState<Range>(() => ({ t0: 0, t1: duration }))
  useEffect(() => setStrip({ t0: 0, t1: duration }), [id, duration])
  const [picked, setPicked] = useState<PickedBlock>()
  const [timer, setTimer] = useState<{ id: number; name: string }>()
  const [tab, setTab] = useState<'timers' | 'counters' | 'log'>('timers')
  const [lower, setLower] = useState<'stack' | 'tree' | 'inst'>('tree')
  const [showWorkers, setShowWorkers] = useState(false)
  const pane = usePane('perf-trace', '38%', 300)
  const paneRef = useRef<HTMLElement>(null)

  // 帧和书签取不到时要把错误显示出来：以前只显示加载占位，桥接回了坏 JSON 时就一直「在加载」
  const frames = useLoad(() => traceQuery<TraceFrames>(project.id, id, { what: 'frames' }), [project.id, id])
  const marks = useLoad(
    () => traceQuery<TraceBase & { items: Bookmark[] }>(project.id, id, { what: 'bookmarks' }),
    [project.id, id],
  )
  const { main, workers } = useMemo(() => orderLanes(threads), [threads])
  const lanes = useMemo(() => [...main, ...(showWorkers ? workers : [])].map((l) => l.id), [main, workers, showWorkers])
  const w = useRef(1200)
  const timing = useDebounced(
    () => traceQuery<Timing>(project.id, id, { what: 'timing', t0: view.t0, t1: view.t1, px: w.current, lanes }),
    `${view.t0.toFixed(6)}|${view.t1.toFixed(6)}|${lanes.join(',')}`,
  )

  // 一打开先看最慢的那一帧：比从第 0 秒开始看更有用
  const f = frames.data
  useEffect(() => {
    if (!f?.ms.length) return
    let worst = 0
    for (let i = 1; i < f.ms.length; i++) if (f.ms[i] > f.ms[worst]) worst = i
    const s = f.start[worst]
    const e = s + f.ms[worst] / 1000
    const pad = (e - s) * 0.15
    setViewState({ t0: Math.max(0, s - pad), t1: e + pad })
  }, [f])

  const pickRange = (r: Range | undefined) => {
    setRange(r)
    if (r) {
      const pad = (r.t1 - r.t0) * 0.05
      setViewState({ t0: Math.max(0, r.t0 - pad), t1: r.t1 + pad })
    }
  }
  const pickBlock = (b: PickedBlock | undefined) => {
    setPicked(b)
    if (b) {
      setTimer({ id: b.timer, name: b.name })
      setLower('stack')
    }
  }
  const pickTimer = (tid: number, name: string) => {
    setTimer({ id: tid, name })
    setLower('tree')
  }
  const zoom = (t0: number, t1: number) => {
    const pad = Math.max((t1 - t0) * 0.08, 1e-6)
    setViewState({ t0: Math.max(0, t0 - pad), t1: t1 + pad })
  }
  const actions: PanelActions = {
    pickTimer,
    slowest: (tid, name) => {
      setTimer({ id: tid, name })
      setLower('inst')
    },
    zoom,
    setRange,
    pickBlock: (b) => {
      setPicked(b)
      setTimer({ id: b.timer, name: b.name })
    },
  }
  const laneName = (lane: number) => threads.find((x) => x.id === lane)?.name ?? String(lane)

  const items = useMemo(
    () => summary(f, duration, threads.length, marks.data?.items.length ?? 0, range),
    [f, duration, threads.length, marks.data, range],
  )
  const r = range ?? { t0: 0, t1: duration }

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:motion-safe:animate-fade">
      <StatsBar items={items} badge={range ? t('区间') : 'trace'} />
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:lg:flex-row">
        <div className="ue:flex ue:min-h-[420px] ue:min-w-0 ue:flex-1 ue:flex-col">
          <Section
            title={t('帧')}
            aside={
              <span className="ue:flex ue:items-center ue:gap-2 ue:text-caption ue:text-subtle">
                {range ? (
                  <>
                    <span className="ue:font-mono">
                      {fmtAt(range.t0)} – {fmtAt(range.t1)} · {fmtMs((range.t1 - range.t0) * 1000)}
                    </span>
                    <LinkBtn onClick={() => pickRange(undefined)}>{t('整段')}</LinkBtn>
                  </>
                ) : (
                  <span>
                    {t('拖选一段设为分析范围')}
                    <span className="ue:hidden ue:xl:inline"> · {t('滚轮缩放 · 右键拖动平移')}</span>
                  </span>
                )}
                <ZoomControls win={strip} duration={duration} onWin={setStrip} />
              </span>
            }
          >
            <div className="ue:px-3 ue:py-2">
              {frames.error ? (
                <div className="ue:flex ue:items-center ue:gap-2">
                  <div className="ue:min-w-0 ue:flex-1">
                    <ErrorText>{t('读不到帧：{msg}', { msg: frames.error })}</ErrorText>
                  </div>
                  <LinkBtn onClick={() => void frames.reload()}>{t('重试')}</LinkBtn>
                </div>
              ) : f ? (
                <FrameStrip
                  start={f.start}
                  ms={f.ms}
                  duration={duration}
                  range={range}
                  view={view}
                  win={strip}
                  onWin={setStrip}
                  marks={marks.data?.items ?? []}
                  budget={BUDGET}
                  onRange={pickRange}
                  onZoom={(x) => zoom(x.t0, x.t1)}
                />
              ) : (
                <Skeleton rows={2} />
              )}
            </div>
          </Section>
          <Section
            className="ue:min-h-0 ue:flex-1 ue:border-t ue:border-line"
            title={t('时间轴')}
            aside={
              <span className="ue:flex ue:items-center ue:gap-3 ue:text-caption ue:text-subtle">
                <span className="ue:hidden ue:xl:inline">
                  {t('滚轮缩放 · 拖动平移 · 刻度条上拖选范围 · F 缩放到选中 · 右键更多')}
                </span>
                <span className="ue:font-mono">{fmtMs((view.t1 - view.t0) * 1000)}</span>
                <LinkBtn onClick={() => setViewState({ t0: 0, t1: duration })}>
                  <Maximize2 className="ue:h-3 ue:w-3" /> {t('看全部')}
                </LinkBtn>
              </span>
            }
          >
            <ErrorText>{timing.error}</ErrorText>
            <WidthProbe onWidth={(n) => (w.current = n)} />
            <Timeline
              main={main}
              workers={workers}
              showWorkers={showWorkers}
              onToggleWorkers={() => setShowWorkers((s) => !s)}
              timing={timing.data}
              loading={timing.loading}
              view={view}
              setView={setView}
              duration={duration}
              range={range}
              onRange={setRange}
              frames={f}
              marks={marks.data?.items ?? []}
              budget={BUDGET.target}
              timer={timer?.id}
              picked={picked}
              onPick={pickBlock}
              actions={actions}
            />
          </Section>
        </div>
        <aside
          ref={paneRef}
          style={pane.style('60%')}
          className="ue:relative ue:flex ue:min-h-[480px] ue:shrink-0 ue:flex-col ue:border-t ue:border-line ue:lg:w-(--ue-w) ue:lg:max-w-(--ue-max) ue:lg:border-t-0 ue:lg:border-l"
        >
          <div className="ue:absolute ue:inset-y-0 ue:-left-[3px] ue:hidden ue:w-[6px] ue:lg:block">
            <SplitHandle pane={pane} paneRef={paneRef} side="right" reserve={() => 480} edge />
          </div>
          <div className="ue:flex ue:min-h-0 ue:flex-[1.1] ue:flex-col">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { key: 'timers', label: t('计时器') },
                { key: 'counters', label: t('计数器') },
                { key: 'log', label: t('日志') },
              ]}
            />
            <div key={tab} className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:motion-safe:animate-fade">
              {tab === 'timers' && (
                <TimersTable
                  id={id}
                  range={range}
                  seconds={r.t1 - r.t0}
                  picked={timer?.id}
                  actions={{ onPick: (x) => pickTimer(x.id, x.name), onSlowest: (x) => actions.slowest(x.id, x.name) }}
                />
              )}
              {tab === 'counters' && <Counters id={id} range={range} duration={duration} />}
              {tab === 'log' && (
                <TraceLog
                  id={id}
                  range={range}
                  onJump={(s) => {
                    const half = (view.t1 - view.t0) / 2
                    setViewState({ t0: Math.max(0, s - half), t1: s + half })
                  }}
                />
              )}
            </div>
          </div>
          <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:border-t ue:border-line">
            {timer && (
              <Tabs
                value={lower === 'stack' && !picked ? 'tree' : lower}
                onChange={setLower}
                items={[
                  { key: 'tree', label: t('调用者 / 被调用者') },
                  ...(picked ? [{ key: 'stack' as const, label: t('调用堆栈') }] : []),
                  { key: 'inst', label: t('每次调用') },
                ]}
              />
            )}
            <div
              key={`${lower}-${timer?.id}`}
              className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:motion-safe:animate-fade"
            >
              {lower === 'stack' && picked ? (
                <StackView
                  key={`${picked.lane}-${picked.time}`}
                  id={id}
                  block={picked}
                  laneName={laneName(picked.lane)}
                  onDepth={(d) => setPicked({ ...picked, depth: d })}
                  actions={actions}
                />
              ) : lower === 'inst' && timer ? (
                <InstancesView
                  id={id}
                  range={range}
                  timer={timer.id}
                  name={timer.name}
                  laneName={laneName}
                  actions={actions}
                />
              ) : timer ? (
                <CallTree id={id} range={range} timer={timer.id} name={timer.name} actions={actions} />
              ) : (
                <Empty>
                  {t(
                    '选一段时间（帧条或时间轴刻度条上拖），再在计时器表里点一行看调用者 / 被调用者；在时间轴上点一块看它的调用堆栈',
                  )}
                </Empty>
              )}
            </div>
            {onAgent && (
              <div className="ue:border-t ue:border-line ue:px-3 ue:py-2">
                <LinkBtn
                  onClick={() =>
                    onAgent(
                      [
                        `分析范围：${fmtAt(r.t0)} – ${fmtAt(r.t1)}（ue_capture 的 from=${r.t0.toFixed(4)} to=${r.t1.toFixed(4)}）`,
                        timer ? `我在看的计时器：${timer.name}（id ${timer.id}）` : '',
                        picked
                          ? `点中的块：${laneName(picked.lane)} 线程 ${fmtAt(picked.time)}，${picked.name} ${fmtMs(picked.ms)}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join('\n'),
                    )
                  }
                >
                  <MessageSquare className="ue:h-3.5 ue:w-3.5" /> {t('让 Agent 分析这段')}
                </LinkBtn>
              </div>
            )}
          </div>
        </aside>
      </div>
      {f && f.total > f.start.length && <Note tone="info">{t('帧太多，只读了前 {n} 帧', { n: f.start.length })}</Note>}
    </div>
  )
}

/** 量时间轴的宽度：按像素宽度向服务端要数据（比半个像素还短的块不回） */
function WidthProbe({ onWidth }: { onWidth: (w: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => onWidth(Math.max(200, el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- 只挂一次，回调只写 ref
  }, [])
  return <div ref={ref} className="ue:h-0 ue:w-full" />
}

/** 摘要读数条：帧数、平均 / P95 / 最慢、FPS、卡顿帧数、时长、线程、书签 */
function summary(
  f: TraceFrames | undefined,
  duration: number,
  threads: number,
  marks: number,
  range?: Range,
): StatItem[] {
  // 有分析范围时只算和范围有重叠的帧（一帧比范围还长时也算上它）
  const ms =
    range && f ? f.ms.filter((m, i) => f.start[i] < range.t1 && f.start[i] + m / 1000 > range.t0) : (f?.ms ?? [])
  const sorted = [...ms].sort((a, b) => a - b)
  const avg = ms.length ? ms.reduce((s, x) => s + x, 0) / ms.length : undefined
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : undefined
  const max = sorted.at(-1)
  const hitches = ms.filter((x) => x > BUDGET.unacceptable).length
  const lv = (v?: number) =>
    (v === undefined
      ? 'none'
      : v > BUDGET.unacceptable
        ? 'bad'
        : v > BUDGET.target
          ? 'warn'
          : 'ok') as StatItem['level']
  // 走势线：按 60 段取最大值
  const spark = (() => {
    if (ms.length < 2) return []
    const n = Math.min(60, ms.length)
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i * ms.length) / n)
      const b = Math.max(a + 1, Math.floor(((i + 1) * ms.length) / n))
      out.push(Math.max(...ms.slice(a, b)))
    }
    return out
  })()
  return [
    { key: 'avg', label: t('平均帧'), value: avg?.toFixed(1), unit: 'ms', level: lv(avg), spark },
    { key: 'p95', label: 'P95', value: p95?.toFixed(1), unit: 'ms', level: lv(p95) },
    { key: 'max', label: t('最慢'), value: max?.toFixed(1), unit: 'ms', level: lv(max) },
    { key: 'fps', label: 'FPS', value: avg ? (1000 / avg).toFixed(0) : undefined },
    {
      key: 'hitch',
      label: t('卡顿帧'),
      value: f ? String(hitches) : undefined,
      level: hitches ? 'bad' : 'ok',
      title: t('超过 {n} ms 的帧', { n: BUDGET.unacceptable }),
    },
    { key: 'frames', label: t('帧数'), value: f ? (range ? ms.length : f.total).toLocaleString() : undefined },
    range
      ? { key: 'dur', label: t('区间'), value: fmtMs((range.t1 - range.t0) * 1000) }
      : { key: 'dur', label: t('时长'), value: duration.toFixed(1), unit: 's' },
    { key: 'threads', label: t('线程'), value: String(threads) },
    { key: 'marks', label: t('书签'), value: String(marks) },
  ]
}
