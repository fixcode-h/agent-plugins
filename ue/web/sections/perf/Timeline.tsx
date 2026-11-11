import { ChevronRight, Copy, Crosshair, GitFork, Highlighter, Layers, Maximize2, Scan, Search, X, ZoomIn } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { h, t } from '../../host.ts'
import { readTheme, setup, tickLabel, tickStep, useThemeTick, useWidth } from './canvas.ts'
import { copyText, openMenu, type MenuItem } from './menu.tsx'
import { fmtAt, fmtMs } from './parts.tsx'
import type { PanelActions } from './TracePanels.tsx'
import {
  blockColor,
  type Bookmark,
  type Lane,
  type LaneBlocks,
  type PickedBlock,
  type Range,
  type Timing,
} from './trace.ts'

/**
 * 时间轴（Insights 的 Timing View）：每个线程一条泳道，作用域一层套一层往下画，就是函数调用堆栈。
 * - 滚轮缩放（以鼠标为中心），拖动平移（左右平移时间、上下滚泳道），点一块 = 选中它（右栏显示它的调用堆栈），F 键缩放到选中。
 * - 在顶上的刻度条上拖 = 选一段时间当分析范围（Insights 的做法），计时器、调用树、计数器、日志都只算这一段；双击一块 = 把它的时间设成范围。
 * - 刻度条下沿标出每一帧的分界和帧号；悬浮提示照 Insights：占父 / 占根、包含 / 独占时间、深度。各处右键有菜单。
 * - 块的颜色按名字哈希，同一个函数同一个颜色；超过一帧预算的块描红边；选中计时器的所有块描边。
 * - 数据按「看得见的范围和像素宽度」取（父组件负责），比半个像素还短的块服务端就不回了。
 */
const RULER = 30
/** 刻度条下面那一行画帧号 */
const FRAME_ROW = 10
const HEAD = 18
const ROW = 15
const MAX_ROWS = 32

interface LaneLayout {
  lane: Lane
  y: number
  rows: number
  /** 折叠的工作线程组：只有标题 */
  group?: number
}

export function Timeline({
  main,
  workers,
  showWorkers,
  onToggleWorkers,
  timing,
  loading,
  view,
  setView,
  duration,
  range,
  onRange,
  frames,
  marks,
  budget,
  timer,
  picked,
  onPick,
  actions,
}: {
  main: Lane[]
  workers: Lane[]
  showWorkers: boolean
  onToggleWorkers: () => void
  timing?: Timing
  loading: boolean
  view: Range
  setView: (r: Range) => void
  duration: number
  range?: Range
  onRange: (r: Range | undefined) => void
  frames?: { start: number[]; ms: number[] }
  marks: Bookmark[]
  budget: number
  timer?: number
  picked?: PickedBlock
  onPick: (b: PickedBlock | undefined) => void
  actions: PanelActions
}) {
  const { cn } = h()
  const scroller = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const w = useWidth(el)
  const theme = useThemeTick()
  const [hover, setHover] = useState<{ x: number; y: number; b: PickedBlock; i: number }>()
  const drag = useRef<{ x: number; y: number; view: Range; top: number; moved: boolean } | null>(null)
  /** 在刻度条上拖着选的那一段（松手才交给 onRange） */
  const [sel, setSel] = useState<{ a: number; b: number }>()
  const viewRef = useRef(view)
  viewRef.current = view

  const byLane = useMemo(() => new Map((timing?.lanes ?? []).map((l) => [l.id, l])), [timing])
  const layout = useMemo(() => {
    const out: LaneLayout[] = []
    let y = RULER
    const add = (lane: Lane) => {
      const b = byLane.get(lane.id)
      let depth = 0
      for (const d of b?.d ?? []) if (d > depth) depth = d
      const rows = Math.min(MAX_ROWS, b && b.d.length ? depth + 1 : 1)
      out.push({ lane, y, rows })
      y += HEAD + rows * ROW + 4
    }
    main.forEach(add)
    if (workers.length) {
      out.push({ lane: { id: -999, name: '', group: '' }, y, rows: 0, group: workers.length })
      y += HEAD + 4
      if (showWorkers) workers.forEach(add)
    }
    return { lanes: out, height: y + 8 }
  }, [main, workers, showWorkers, byLane])

  const span = Math.max(view.t1 - view.t0, 1e-7)
  const xOf = (s: number) => ((s - view.t0) / span) * w
  const tOf = (px: number) => view.t0 + (px / Math.max(w, 1)) * span

  // ---------- 画 ----------
  useEffect(() => {
    const c = cv.current
    if (!c || !w) return
    const H = layout.height
    const g = setup(c, w, H)
    const th = readTheme(c)
    // 字体跟页面一致（直接写 ui-sans-serif 时有的系统回落到空格没有宽度的字体）
    const family = getComputedStyle(c).fontFamily || 'sans-serif'
    const font = `11px ${family}`
    g.font = font
    g.textBaseline = 'middle'
    // 分析范围（或正在刻度条上拖的那段）外压暗
    const r = sel ? { t0: Math.min(sel.a, sel.b), t1: Math.max(sel.a, sel.b) } : range
    if (r) {
      g.fillStyle = th.hover
      const a = xOf(r.t0)
      const b = xOf(r.t1)
      if (a > 0) g.fillRect(0, 0, a, H)
      if (b < w) g.fillRect(b, 0, w - b, H)
    }
    // 帧的分界：刻度条下沿一行，相邻帧交替深浅，帧够宽时写帧号
    if (frames?.start.length) {
      const st = frames.start
      let lo = 0
      let hi = st.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (st[mid] <= view.t0) lo = mid
        else hi = mid - 1
      }
      const y = RULER - FRAME_ROW - 1
      for (let i = lo; i < st.length && st[i] <= view.t1; i++) {
        const x0 = xOf(st[i])
        const x1 = xOf(st[i] + frames.ms[i] / 1000)
        if (x1 - x0 < 0.5) continue
        g.fillStyle = frames.ms[i] > budget ? th.danger : th.line
        g.globalAlpha = frames.ms[i] > budget ? 0.35 : i % 2 ? 0.9 : 0.45
        g.fillRect(Math.max(0, x0), y, Math.min(w, x1) - Math.max(0, x0), FRAME_ROW)
        g.globalAlpha = 1
        if (x1 - x0 > 46) {
          g.fillStyle = th.muted
          g.font = `10px ${family}`
          g.fillText(t('帧 {n}', { n: i }), Math.max(0, x0) + 3, y + FRAME_ROW / 2 + 0.5)
          g.font = font
        }
      }
    }
    // 刻度
    const step = tickStep(span, w)
    g.fillStyle = th.subtle
    g.strokeStyle = th.line
    g.lineWidth = 1
    for (let s = Math.ceil(view.t0 / step) * step; s <= view.t1; s += step) {
      const px = Math.round(xOf(s)) + 0.5
      g.beginPath()
      g.moveTo(px, 2)
      g.lineTo(px, H)
      g.globalAlpha = 0.5
      g.stroke()
      g.globalAlpha = 1
      g.fillText(tickLabel(s, step), px + 4, (RULER - FRAME_ROW) / 2)
    }
    g.fillStyle = th.line
    g.fillRect(0, RULER - 1, w, 1)

    for (const L of layout.lanes) {
      // 泳道标题
      g.fillStyle = th.hover
      g.fillRect(0, L.y, w, HEAD)
      g.fillStyle = th.muted
      g.font = `600 ${font}`
      const title = L.group ? `${showWorkers ? '▾' : '▸'}  ${t('工作线程')}（${L.group}）` : L.lane.name
      g.fillText(title, 8, L.y + HEAD / 2)
      g.font = font
      if (L.group) continue
      const b = byLane.get(L.lane.id)
      if (!b) continue
      const y0 = L.y + HEAD
      for (let i = 0; i < b.s.length; i++) {
        const d = b.d[i]
        if (d >= MAX_ROWS) continue
        const x0 = xOf(b.s[i])
        const x1 = xOf(b.s[i] + b.ms[i] / 1000)
        if (x1 < 0 || x0 > w) continue
        const bx = Math.max(-1, x0)
        const bw = Math.max(1, Math.min(w + 1, x1) - bx)
        const by = y0 + d * ROW
        const name = timing?.names[String(b.t[i])] ?? ''
        g.fillStyle = blockColor(name, th.dark)
        g.fillRect(bx, by, bw, ROW - 1)
        if (b.ms[i] > budget) {
          g.strokeStyle = th.danger
          g.lineWidth = 1
          g.strokeRect(bx + 0.5, by + 0.5, bw - 1, ROW - 2)
        }
        if (timer !== undefined && b.t[i] === timer) {
          g.strokeStyle = th.fg
          g.lineWidth = 1.5
          g.strokeRect(bx + 0.75, by + 0.75, bw - 1.5, ROW - 2.5)
        }
        if (bw > 28) {
          g.save()
          g.beginPath()
          g.rect(bx + 3, by, bw - 6, ROW - 1)
          g.clip()
          g.fillStyle = th.dark ? 'rgba(255,255,255,.92)' : 'rgba(0,0,0,.82)'
          // 和 Insights 一样块里写「名字 (耗时)」，放不下就只写名字
          g.fillText(bw > 90 ? `${name} (${fmtMs(b.ms[i])})` : name, Math.max(bx, 0) + 3, by + ROW / 2)
          g.restore()
        }
      }
    }
    // 选中的块
    if (picked) {
      const L = layout.lanes.find((x) => !x.group && x.lane.id === picked.lane)
      if (L && picked.depth < MAX_ROWS) {
        const x0 = xOf(picked.time)
        const x1 = xOf(picked.time + picked.ms / 1000)
        g.strokeStyle = th.accent
        g.lineWidth = 2
        g.strokeRect(
          Math.max(-2, x0) + 1,
          L.y + HEAD + picked.depth * ROW + 1,
          Math.max(2, Math.min(w + 2, x1) - Math.max(-2, x0) - 2),
          ROW - 3,
        )
      }
    }
    // 书签
    g.setLineDash([3, 3])
    g.strokeStyle = th.accent
    g.fillStyle = th.accent
    for (const m of marks) {
      const px = Math.round(xOf(m.t)) + 0.5
      if (px < 0 || px > w) continue
      g.beginPath()
      g.moveTo(px, RULER)
      g.lineTo(px, H)
      g.stroke()
      // 书签名垫一块底色，和刻度文字叠在一起时也看得清
      const label = `▾ ${m.text}`
      const lw = g.measureText(label).width + 6
      g.fillStyle = th.card
      g.fillRect(px + 1, 2, lw, RULER - FRAME_ROW - 5)
      g.fillStyle = th.accent
      g.fillText(label, px + 4, (RULER - FRAME_ROW) / 2)
    }
    g.setLineDash([])
    // 范围的两条边和时长（贴在刻度条上）
    if (r) {
      const a = xOf(r.t0)
      const b = xOf(r.t1)
      g.strokeStyle = th.accent
      g.lineWidth = 1
      for (const px of [a, b]) {
        if (px < -1 || px > w + 1) continue
        g.beginPath()
        g.moveTo(Math.round(px) + 0.5, 0)
        g.lineTo(Math.round(px) + 0.5, H)
        g.stroke()
      }
      const label = fmtMs((r.t1 - r.t0) * 1000)
      const lw = g.measureText(label).width + 10
      const mid = Math.max(lw / 2 + 2, Math.min(w - lw / 2 - 2, (Math.max(a, 0) + Math.min(b, w)) / 2))
      g.fillStyle = th.accent
      g.fillRect(mid - lw / 2, 3, lw, RULER - FRAME_ROW - 7)
      g.fillStyle = th.card
      g.fillText(label, mid - lw / 2 + 5, (RULER - FRAME_ROW) / 2)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- xOf 由 view / w 算出，列它们就够
  }, [w, layout, timing, view, range, sel, frames, marks, budget, timer, picked, theme, showWorkers])

  // ---------- 交互 ----------
  /** 鼠标下是哪一块 */
  const hit = (px: number, py: number): { b: PickedBlock; i: number } | undefined => {
    const L = layout.lanes.find((x) => !x.group && py >= x.y + HEAD && py < x.y + HEAD + x.rows * ROW)
    if (!L) return undefined
    const b = byLane.get(L.lane.id)
    if (!b) return undefined
    const depth = Math.floor((py - L.y - HEAD) / ROW)
    const s = tOf(px)
    // 最小点中宽度 2 像素：很窄的块也点得到
    const slack = (2 / Math.max(w, 1)) * span
    for (let i = 0; i < b.s.length; i++) {
      if (b.d[i] !== depth) continue
      const e = b.s[i] + b.ms[i] / 1000
      if (b.s[i] - slack <= s && s <= e + slack)
        return {
          i,
          b: {
            lane: L.lane.id,
            time: b.s[i],
            depth,
            timer: b.t[i],
            ms: b.ms[i],
            name: timing?.names[String(b.t[i])] ?? '',
            excl: b.x?.[i],
          },
        }
    }
    return undefined
  }
  const local = (e: { clientX: number; clientY: number }) => {
    const r = cv.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const clampView = (t0: number, t1: number): Range => {
    const s = Math.min(Math.max(t1 - t0, 1e-5), Math.max(duration, 1e-3) * 1.05)
    let a = t0
    if (a < -s * 0.05) a = -s * 0.05
    if (a + s > duration + s * 0.05) a = duration + s * 0.05 - s
    return { t0: a, t1: a + s }
  }

  // 滚轮缩放要拦住页面滚动：React 的 onWheel 是 passive 的，只能自己挂
  useEffect(() => {
    const c = cv.current
    if (!c) return
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey) return // Shift + 滚轮留给上下滚泳道
      e.preventDefault()
      const v = viewRef.current
      const r = c.getBoundingClientRect()
      const f = (e.clientX - r.left) / Math.max(r.width, 1)
      const at = v.t0 + f * (v.t1 - v.t0)
      const k = Math.exp(e.deltaY * 0.0015)
      const s = (v.t1 - v.t0) * k
      setView(clampView(at - f * s, at - f * s + s))
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- 视图从 ref 读，挂一次就够；duration 变了才重挂
  }, [duration, setView])

  const zoomTo = (t0: number, t1: number) => {
    const pad = (t1 - t0) * 0.08
    setView(clampView(t0 - pad, t1 + pad))
  }

  // ---------- 右键菜单 ----------
  const blockMenu = (b: PickedBlock): MenuItem[] => {
    const e = b.time + b.ms / 1000
    const lane = [...main, ...workers].find((l) => l.id === b.lane)?.name ?? ''
    return [
      { title: `${b.name} · ${fmtMs(b.ms)}` },
      { label: t('看调用堆栈'), icon: Layers, onClick: () => onPick(b) },
      { label: t('缩放到这一块'), icon: ZoomIn, hint: 'F', onClick: () => zoomTo(b.time, e) },
      { label: t('设为分析范围'), icon: Scan, hint: t('双击'), onClick: () => onRange({ t0: b.time, t1: e }) },
      'sep',
      { label: t('看调用者 / 被调用者'), icon: GitFork, onClick: () => actions.pickTimer(b.timer, b.name) },
      {
        label: t('高亮同一个计时器'),
        icon: Highlighter,
        checked: timer === b.timer,
        onClick: () => actions.pickTimer(b.timer, b.name),
      },
      { label: t('找最慢的一次'), icon: Search, onClick: () => actions.slowest(b.timer, b.name) },
      'sep',
      { label: t('复制名字'), icon: Copy, onClick: () => copyText(b.name) },
      {
        label: t('复制详情'),
        onClick: () =>
          copyText(
            `${b.name}\n${lane} @ ${fmtAt(b.time)}\nInclusive ${fmtMs(b.ms)}${b.excl !== undefined ? ` · Exclusive ${fmtMs(b.excl)}` : ''} · Depth ${b.depth}`,
          ),
      },
    ]
  }
  const viewMenu = (at: number): MenuItem[] => [
    { label: t('看全部'), icon: Maximize2, onClick: () => setView({ t0: 0, t1: duration }) },
    range && { label: t('缩放到分析范围'), icon: ZoomIn, onClick: () => zoomTo(range.t0, range.t1) },
    { label: t('把当前看的这段设为分析范围'), icon: Scan, onClick: () => onRange({ t0: Math.max(0, view.t0), t1: Math.min(duration, view.t1) }) },
    range && { label: t('清除分析范围'), icon: X, onClick: () => onRange(undefined) },
    'sep',
    workers.length > 0 && {
      label: showWorkers ? t('收起工作线程') : t('展开 {n} 个工作线程', { n: workers.length }),
      onClick: onToggleWorkers,
    },
    { label: t('复制这个时间点'), icon: Crosshair, hint: fmtAt(at), onClick: () => copyText(at.toFixed(6)) },
  ].filter(Boolean) as MenuItem[]

  return (
    <div className="ue:relative ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      {/* 取数时顶上一条细的闪光进度条 */}
      <div
        className={cn(
          'ue:pointer-events-none ue:absolute ue:inset-x-0 ue:top-0 ue:z-10 ue:h-0.5 ue:bg-[linear-gradient(90deg,transparent,var(--accent),transparent)] ue:bg-[length:200%_100%] ue:transition-opacity ue:duration-300 ue:motion-safe:animate-shimmer',
          loading ? 'ue:opacity-100' : 'ue:opacity-0',
        )}
      />
      <div
        ref={(n) => {
          scroller.current = n
          setEl(n)
        }}
        tabIndex={0}
        className="ue:min-h-0 ue:flex-1 ue:overflow-x-hidden ue:overflow-y-auto ue:outline-none"
        onKeyDown={(e) => {
          if (e.key === 'f' || e.key === 'F') {
            if (picked) zoomTo(picked.time, picked.time + picked.ms / 1000)
            else if (range) zoomTo(range.t0, range.t1)
            else zoomTo(0, duration)
          } else if (e.key === 'Escape') onPick(undefined)
          else return
          e.preventDefault()
        }}
      >
        <canvas
          ref={cv}
          className={cn('ue:block', drag.current?.moved ? 'ue:cursor-grabbing' : 'ue:cursor-default')}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            const p = local(e)
            // 刻度条上按下：拖选分析范围
            if (p.y < RULER) {
              const at = tOf(p.x)
              setSel({ a: at, b: at })
              return
            }
            drag.current = { x: e.clientX, y: e.clientY, view, top: scroller.current?.scrollTop ?? 0, moved: false }
          }}
          onPointerMove={(e) => {
            const p = local(e)
            if (sel) {
              setSel({ ...sel, b: Math.max(0, Math.min(duration, tOf(p.x))) })
              return
            }
            const d = drag.current
            if (d) {
              const dx = e.clientX - d.x
              const dy = e.clientY - d.y
              if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
              d.moved = true
              setHover(undefined)
              const s = d.view.t1 - d.view.t0
              const t0 = d.view.t0 - (dx / Math.max(w, 1)) * s
              setView(clampView(t0, t0 + s))
              if (scroller.current) scroller.current.scrollTop = d.top - dy
              return
            }
            const h = hit(p.x, p.y)
            setHover(h ? { x: p.x, y: p.y, ...h } : undefined)
          }}
          onPointerUp={(e) => {
            if (sel) {
              const a = Math.max(0, Math.min(sel.a, sel.b))
              const b = Math.min(duration, Math.max(sel.a, sel.b))
              setSel(undefined)
              // 在刻度条上点一下（没拖开）= 清掉范围
              onRange(xOf(b) - xOf(a) < 3 ? undefined : { t0: a, t1: b })
              return
            }
            const d = drag.current
            drag.current = null
            if (!d || d.moved) return
            const p = local(e)
            const L = layout.lanes.find((x) => x.group && p.y >= x.y && p.y < x.y + HEAD)
            if (L) return onToggleWorkers()
            onPick(hit(p.x, p.y)?.b)
          }}
          onPointerLeave={() => setHover(undefined)}
          onDoubleClick={(e) => {
            const p = local(e)
            const b = hit(p.x, p.y)?.b
            // 双击一块 = 把它的时间设成分析范围并放大过去（Insights 的做法）
            if (b) {
              onRange({ t0: b.time, t1: b.time + b.ms / 1000 })
              zoomTo(b.time, b.time + b.ms / 1000)
            }
          }}
          onContextMenu={(e) => {
            const p = local(e)
            const hb = p.y >= RULER ? hit(p.x, p.y) : undefined
            setHover(undefined)
            openMenu(e, [...(hb ? blockMenu(hb.b) : []), 'sep', ...viewMenu(tOf(p.x))])
          }}
        />
      </div>
      {hover && (
        <BlockTip
          key={`${hover.b.lane}-${hover.b.time}-${hover.b.depth}`}
          b={hover.b}
          ctx={blockContext(byLane.get(hover.b.lane), hover.i, timing?.names ?? {})}
          lane={[...main, ...workers].find((l) => l.id === hover.b.lane)?.name ?? ''}
          budget={budget}
          left={Math.min(hover.x + 14, Math.max(0, w - 300))}
          top={hover.y - (scroller.current?.scrollTop ?? 0) + 16}
        />
      )}
      {timing?.cut && (
        <div className="ue:pointer-events-none ue:absolute ue:right-3 ue:bottom-2 ue:rounded-md ue:bg-warning/15 ue:px-2 ue:py-0.5 ue:text-caption ue:text-warning ue:motion-safe:animate-rise">
          {t('块太多，只画了前 2 万个：放大看细节')}
        </div>
      )}
      <WorkersHint show={!!workers.length && !showWorkers} onClick={onToggleWorkers} count={workers.length} />
    </div>
  )
}

/**
 * 悬浮的那一块在调用栈里的位置：外面一层（父）、最外层（根）是谁，以及独占时间。
 * 父和根在同一条泳道的数据里找（开始不晚于它、结束不早于它、深度小一层 / 0 层的那块）；
 * 独占时间桥接 1.5.0 起直接给，旧桥接用「自己减去回来的子块」估算（太短没回的子块会算进独占）。
 */
interface BlockCtx {
  parent?: { name: string; ms: number }
  root?: { name: string; ms: number }
  excl: number
  approx: boolean
}
function blockContext(b: LaneBlocks | undefined, i: number, names: Record<string, string>): BlockCtx | undefined {
  if (!b || i < 0 || i >= b.s.length) return undefined
  const d = b.d[i]
  const s0 = b.s[i]
  const e0 = s0 + b.ms[i] / 1000
  const eps = 1e-9
  let parent: BlockCtx['parent']
  let root: BlockCtx['root']
  let child = 0
  for (let j = 0; j < b.s.length; j++) {
    if (j === i) continue
    const s1 = b.s[j]
    const e1 = s1 + b.ms[j] / 1000
    if (b.d[j] < d && s1 <= s0 + eps && e1 >= e0 - eps) {
      if (b.d[j] === d - 1) parent = { name: names[String(b.t[j])] ?? '', ms: b.ms[j] }
      if (b.d[j] === 0) root = { name: names[String(b.t[j])] ?? '', ms: b.ms[j] }
    } else if (b.x === undefined && b.d[j] === d + 1 && s1 >= s0 - eps && e1 <= e0 + eps) child += b.ms[j]
  }
  const x = b.x?.[i]
  return { parent, root, excl: x ?? Math.max(0, b.ms[i] - child), approx: x === undefined }
}

/** 时间轴的悬浮提示（照 Insights）：名字，占父 / 占根，包含 / 独占时间，深度，线程和开始时间 */
function BlockTip({
  b,
  ctx,
  lane,
  budget,
  left,
  top,
}: {
  b: PickedBlock
  ctx?: BlockCtx
  lane: string
  budget: number
  left: number
  top: number
}) {
  const { cn } = h()
  const pct = (v: number, of: number) => `${((v / Math.max(of, 1e-9)) * 100).toFixed(2)}%`
  const rows: [string, ReactNode][] = []
  if (ctx?.parent)
    rows.push([
      t('占父'),
      <>
        {pct(b.ms, ctx.parent.ms)} <span className="ue:text-subtle">{ctx.parent.name}</span>
      </>,
    ])
  if (ctx?.root && b.depth > 0)
    rows.push([
      t('占根'),
      <>
        {pct(b.ms, ctx.root.ms)} <span className="ue:text-subtle">{ctx.root.name}</span>
      </>,
    ])
  rows.push([t('包含时间'), <span className={cn(b.ms > budget && 'ue:text-danger')}>{fmtMs(b.ms)}</span>])
  if (ctx)
    rows.push([
      t('独占时间'),
      <>
        {ctx.approx ? '≈ ' : ''}
        {fmtMs(ctx.excl)} <span className="ue:text-subtle">({pct(ctx.excl, b.ms)})</span>
      </>,
    ])
  rows.push([t('深度'), String(b.depth)])
  rows.push([t('线程'), lane])
  rows.push([t('开始'), fmtAt(b.time)])
  return (
    <div
      className="ue:pointer-events-none ue:absolute ue:z-20 ue:max-w-[360px] ue:rounded-lg ue:border ue:border-line ue:bg-card ue:px-2.5 ue:py-1.5 ue:text-caption ue:shadow-lg ue:motion-safe:animate-fade"
      style={{ left, top }}
    >
      <div className="ue:truncate ue:font-medium ue:text-accent">{b.name}</div>
      <div className="ue:mt-1 ue:grid ue:grid-cols-[auto_minmax(0,1fr)] ue:gap-x-3 ue:gap-y-0.5">
        {rows.map(([k, v]) => (
          <span key={k} className="ue:contents">
            <span className="ue:text-right ue:text-subtle">{k}:</span>
            <span className="ue:truncate ue:font-mono ue:text-fg">{v}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** 底部提示：工作线程折叠着，点开逐个看 */
function WorkersHint({ show, count, onClick }: { show: boolean; count: number; onClick: () => void }) {
  if (!show) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className="ue:absolute ue:bottom-2 ue:left-3 ue:flex ue:items-center ue:gap-1 ue:rounded-md ue:border ue:border-line ue:bg-card ue:px-2 ue:py-0.5 ue:text-caption ue:text-subtle ue:shadow-sm ue:transition-colors ue:hover:text-fg ue:motion-safe:animate-rise"
    >
      <ChevronRight className="ue:h-3 ue:w-3" />
      {t('展开 {n} 个工作线程', { n: count })}
    </button>
  )
}
