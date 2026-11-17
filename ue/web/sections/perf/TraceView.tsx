import { Maximize2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { SplitHandle, usePane } from '../../split.tsx'
import { ErrorText, LinkBtn, Note } from '../../ui.tsx'
import { useOpenLua } from '../lua/open-file.ts'
import { FramesSection } from './FramesSection.tsx'
import { LUA_COUNTERS, LuaTraceCtx, useLuaFrames, useLuaInfo, type LuaTrace } from './lua-trace.ts'
import { LuaToggles } from './LuaToggles.tsx'
import { LowerPane, type Lower } from './LowerPane.tsx'
import { Section, Skeleton, Tabs, fmtMs } from './parts.tsx'
import { StatsBar } from './StatsBar.tsx'
import { Timeline } from './Timeline.tsx'
import { TimersTable } from './TimersTable.tsx'
import { Counters, TraceLog } from './TraceExtras.tsx'
import type { PanelActions } from './TracePanels.tsx'
import { BUDGET, traceSummary } from './trace-summary.ts'
import {
  orderLanes,
  traceQuery,
  progressNote,
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

/**
 * 一份 trace 的详情（性能页设计 4、效果图 2）：顶上摘要读数条，下面帧条（拖选分析范围）、时间轴（函数调用堆栈），
 * 右栏上半是计时器 / 计数器 / 日志，下半是选中计时器的调用者 / 被调用者（上下两棵树，照 Insights）、点中块的调用堆栈、计时器的每次调用。
 * 分析范围（帧条拖选、时间轴刻度条拖选、双击一块）一变，摘要、计时器、调用树、计数器、日志都只算这一段。
 * 第一次打开要等编辑器（或后台编辑器）用 TraceServices 分析完，分析中显示进度。
 */
export function TraceView({ capture, onAgent }: { capture: Capture; onAgent?: (extra: string) => void }) {
  const { project } = useUe()
  const { info, error, ready, rev } = useTraceInfo(project.id, capture.id)
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
              ? progressNote(info)
              : t('正在分析 trace…第一次要启动后台编辑器，可能要一两分钟（编辑器开着时用编辑器分析，快得多）')
          }
        />
      </div>
    )
  return (
    <TraceBody
      capture={capture}
      duration={info!.duration}
      threads={info!.threads}
      growing={info!.analyzing ? { rev, live: !!info!.live, note: progressNote(info!) } : undefined}
      onAgent={onAgent}
    />
  )
}

function TraceBody({
  capture,
  duration,
  threads,
  growing,
  onAgent,
}: {
  capture: Capture
  duration: number
  threads: { id: number; name: string; group: string }[]
  /** 还在分析（录制中跟着读，或第一次分析还没读完）：先显示已有的部分，rev 一变就刷新帧条、书签和末尾的时间轴 */
  growing?: { rev: number; live: boolean; note: string }
  onAgent?: (extra: string) => void
}) {
  const { project } = useUe()
  const id = capture.id
  const [range, setRange] = useState<Range>()
  const [view, setViewState] = useState<Range>(() => ({ t0: 0, t1: Math.min(duration, 0.1) }))
  const setView = useCallback((r: Range) => setViewState(r), [])
  // 帧条自己的缩放窗口（和时间轴的 view 分开）：默认整段，换了 trace 回到整段
  const [strip, setStrip] = useState<Range>(() => ({ t0: 0, t1: duration }))
  // 换了 trace 回到整段；数据还在长时，帧条原来看到末尾的就跟着往后伸（像 Insights 看实时会话），放大看中间的不动
  const lastDur = useRef(duration)
  useEffect(() => setStrip({ t0: 0, t1: lastDur.current }), [id])
  useEffect(() => {
    const prev = lastDur.current
    lastDur.current = duration
    setStrip((s) => (s.t1 >= prev - 1e-6 ? { t0: s.t0, t1: duration } : s))
  }, [duration])
  const rev = growing?.rev ?? -1
  const [picked, setPicked] = useState<PickedBlock>()
  const [timer, setTimer] = useState<{ id: number; name: string }>()
  const [tab, setTab] = useState<'timers' | 'counters' | 'log'>('timers')
  const [lower, setLower] = useState<Lower>('tree')
  const [selFrame, setSelFrame] = useState<number>()
  // Lua 一层（Lua 性能 Insights 化设计 5）：luainfo 认 Lua 计时器，三个计数器按帧对齐；没有 Lua 时都是空的，界面和以前一样
  const luaInfo = useLuaInfo(project.id, id, growing ? Math.floor(rev / 10) : -1)
  const [luaOnly, setLuaOnly] = useState(false)
  const [mergeC, setMergeC] = useState(false)
  const openLua = useOpenLua()
  const lua: LuaTrace = useMemo(
    () => ({ info: luaInfo, luaOnly, setLuaOnly, mergeC, setMergeC, open: openLua }),
    [luaInfo, luaOnly, mergeC, openLua],
  )
  const [showWorkers, setShowWorkers] = useState(false)
  const pane = usePane('perf-trace', '38%', 300)
  const paneRef = useRef<HTMLElement>(null)

  // 帧和书签取不到时要把错误显示出来：以前只显示加载占位，桥接回了坏 JSON 时就一直「在加载」
  const frames = useLoad(() => traceQuery<TraceFrames>(project.id, id, { what: 'frames' }), [project.id, id, rev])
  const marks = useLoad(
    () => traceQuery<TraceBase & { items: Bookmark[] }>(project.id, id, { what: 'bookmarks' }),
    [project.id, id, rev],
  )
  const { main, workers } = useMemo(() => orderLanes(threads), [threads])
  const lanes = useMemo(() => [...main, ...(showWorkers ? workers : [])].map((l) => l.id), [main, workers, showWorkers])
  const w = useRef(1200)
  // 还在长的 trace：看的这段超过了上次取到的数据末尾，就跟着 rev 再取（看前面已经分析完的部分不重复取）
  const timingEnd = useRef(Infinity)
  const tail = growing && view.t1 > timingEnd.current ? rev : -1
  const timing = useDebounced(
    () =>
      traceQuery<Timing>(project.id, id, { what: 'timing', t0: view.t0, t1: view.t1, px: w.current, lanes }).then(
        (r) => {
          timingEnd.current = r.analyzing ? r.duration : Infinity
          return r
        },
      ),
    `${view.t0.toFixed(6)}|${view.t1.toFixed(6)}|${lanes.join(',')}|${tail}`,
  )

  // 一打开先看最慢的那一帧：比从第 0 秒开始看更有用。数据还在长时只跳一次，不然每次刷新都把用户拽回去
  const f = frames.data
  const luaFrames = useLuaFrames(project.id, id, f?.start, duration, luaInfo.lua)
  const jumped = useRef('')
  useEffect(() => {
    if (!f?.ms.length || jumped.current === id) return
    jumped.current = id
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
  // 选中一帧（帧条单击、按 Lua 用时挑一帧）：时间轴跳过去
  const pickFrame = (i: number) => {
    if (!f || f.start[i] === undefined) return
    setSelFrame(i)
    zoom(f.start[i], f.start[i] + f.ms[i] / 1000)
  }
  const actions: PanelActions = {
    pickTimer,
    selectTimer: (tid, name) => setTimer({ id: tid, name }),
    flame: (tid, name) => {
      setTimer({ id: tid, name })
      setLower('flame')
    },
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
    () =>
      traceSummary(f, duration, threads.length, marks.data?.items.length ?? 0, range, luaFrames, () => {
        if (!f || !luaFrames) return
        let worst = 0
        for (let i = 1; i < luaFrames.ms.length; i++) if (luaFrames.ms[i] > luaFrames.ms[worst]) worst = i
        pickRange({ t0: f.start[worst], t1: f.start[worst] + f.ms[worst] / 1000 })
        setSelFrame(worst)
      }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- pickRange 只用 setter
    [f, duration, threads.length, marks.data, range, luaFrames],
  )
  const r = range ?? { t0: 0, t1: duration }

  return (
    <LuaTraceCtx.Provider value={lua}>
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:motion-safe:animate-fade">
      <StatsBar items={items} badge={range ? t('区间') : 'trace'} />
      {growing && (
        <Note tone="info">
          {growing.live
            ? t('还在录制：先显示已经录下的部分，新数据每隔几秒自动补上；停止录制后是完整结果')
            : growing.note}
        </Note>
      )}
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:lg:flex-row">
        <div className="ue:flex ue:min-h-[420px] ue:min-w-0 ue:flex-1 ue:flex-col">
          <FramesSection
            frames={f}
            error={frames.error}
            onRetry={() => void frames.reload()}
            duration={duration}
            range={range}
            view={view}
            strip={strip}
            setStrip={setStrip}
            marks={marks.data?.items ?? []}
            budget={BUDGET}
            lua={luaFrames}
            selected={selFrame}
            onSelect={pickFrame}
            onRange={pickRange}
            onZoom={(x) => zoom(x.t0, x.t1)}
          />
          <Section
            className="ue:min-h-0 ue:flex-1 ue:border-t ue:border-line"
            title={t('时间轴')}
            aside={
              <span className="ue:flex ue:items-center ue:gap-3 ue:text-caption ue:text-subtle">
                <LuaToggles />
                <span className={luaInfo.lua ? 'ue:hidden ue:min-[1900px]:inline' : 'ue:hidden ue:xl:inline'}>
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
                  // 整段统计要扫全部事件，桥接在编辑器游戏线程上算：录制中每多录 10 秒才重算一次，别拖慢被测的编辑器
                  rev={growing ? Math.floor(rev / 10) : -1}
                  picked={timer?.id}
                  actions={{ onPick: (x) => pickTimer(x.id, x.name), onSlowest: (x) => actions.slowest(x.id, x.name) }}
                />
              )}
              {tab === 'counters' && (
                <Counters
                  id={id}
                  range={range}
                  duration={duration}
                  defaults={luaInfo.lua ? [...LUA_COUNTERS] : undefined}
                />
              )}
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
          <LowerPane
            id={id}
            range={range}
            whole={r}
            timer={timer}
            picked={picked}
            setPicked={setPicked}
            lower={lower}
            setLower={setLower}
            hasLua={luaInfo.lua}
            laneName={laneName}
            actions={actions}
            onAgent={onAgent}
          />
        </aside>
      </div>
      {f && f.total > f.start.length && <Note tone="info">{t('帧太多，只读了前 {n} 帧', { n: f.start.length })}</Note>}
    </div>
    </LuaTraceCtx.Provider>
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
