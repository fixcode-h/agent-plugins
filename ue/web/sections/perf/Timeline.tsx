import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { h, t } from '../../host.ts'
import { readTheme, setup, tickLabel, tickStep, useThemeTick, useWidth } from './canvas.ts'
import { fmtAt, fmtMs } from './parts.tsx'
import { blockColor, type Bookmark, type Lane, type PickedBlock, type Range, type Timing } from './trace.ts'

/**
 * 时间轴（Insights 的 Timing View）：每个线程一条泳道，作用域一层套一层往下画，就是函数调用堆栈。
 * - 滚轮缩放（以鼠标为中心），拖动平移（左右平移时间、上下滚泳道），点一块 = 选中它（右栏显示它的调用堆栈），F 键缩放到选中。
 * - 块的颜色按名字哈希，同一个函数同一个颜色；超过一帧预算的块描红边；选中计时器的所有块描边。
 * - 数据按「看得见的范围和像素宽度」取（父组件负责），比半个像素还短的块服务端就不回了。
 */
const RULER = 22
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
  marks,
  budget,
  timer,
  picked,
  onPick,
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
  marks: Bookmark[]
  budget: number
  timer?: number
  picked?: PickedBlock
  onPick: (b: PickedBlock | undefined) => void
}) {
  const { cn } = h()
  const scroller = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const w = useWidth(el)
  const theme = useThemeTick()
  const [hover, setHover] = useState<{ x: number; y: number; b: PickedBlock }>()
  const drag = useRef<{ x: number; y: number; view: Range; top: number; moved: boolean } | null>(null)
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
    // 分析范围外压暗
    if (range) {
      g.fillStyle = th.hover
      const a = xOf(range.t0)
      const b = xOf(range.t1)
      if (a > 0) g.fillRect(0, 0, a, H)
      if (b < w) g.fillRect(b, 0, w - b, H)
    }
    // 刻度
    const step = tickStep(span, w)
    g.fillStyle = th.subtle
    g.strokeStyle = th.line
    g.lineWidth = 1
    for (let s = Math.ceil(view.t0 / step) * step; s <= view.t1; s += step) {
      const px = Math.round(xOf(s)) + 0.5
      g.beginPath()
      g.moveTo(px, RULER - 6)
      g.lineTo(px, H)
      g.globalAlpha = 0.5
      g.stroke()
      g.globalAlpha = 1
      g.fillText(tickLabel(s, step), px + 4, RULER / 2 - 1)
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
          g.fillText(bw > 90 ? `${name} · ${fmtMs(b.ms[i])}` : name, Math.max(bx, 0) + 3, by + ROW / 2)
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
      g.fillRect(px + 1, 2, lw, RULER - 6)
      g.fillStyle = th.accent
      g.fillText(label, px + 4, RULER / 2 - 1)
    }
    g.setLineDash([])
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- xOf 由 view / w 算出，列它们就够
  }, [w, layout, timing, view, range, marks, budget, timer, picked, theme, showWorkers])

  // ---------- 交互 ----------
  /** 鼠标下是哪一块 */
  const hit = (px: number, py: number): PickedBlock | undefined => {
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
          lane: L.lane.id,
          time: b.s[i],
          depth,
          timer: b.t[i],
          ms: b.ms[i],
          name: timing?.names[String(b.t[i])] ?? '',
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
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, y: e.clientY, view, top: scroller.current?.scrollTop ?? 0, moved: false }
          }}
          onPointerMove={(e) => {
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
            const p = local(e)
            const b = hit(p.x, p.y)
            setHover(b ? { x: p.x, y: p.y, b } : undefined)
          }}
          onPointerUp={(e) => {
            const d = drag.current
            drag.current = null
            if (d?.moved) return
            const p = local(e)
            const L = layout.lanes.find((x) => x.group && p.y >= x.y && p.y < x.y + HEAD)
            if (L) return onToggleWorkers()
            onPick(hit(p.x, p.y))
          }}
          onPointerLeave={() => setHover(undefined)}
          onDoubleClick={(e) => {
            const p = local(e)
            const b = hit(p.x, p.y)
            if (b) zoomTo(b.time, b.time + b.ms / 1000)
          }}
        />
      </div>
      {hover && (
        <div
          key={`${hover.b.lane}-${hover.b.time}-${hover.b.depth}`}
          className="ue:pointer-events-none ue:absolute ue:z-20 ue:max-w-80 ue:rounded-lg ue:border ue:border-line ue:bg-card ue:px-2.5 ue:py-1.5 ue:text-caption ue:shadow-lg ue:motion-safe:animate-fade"
          style={{
            left: Math.min(hover.x + 14, Math.max(0, w - 260)),
            top: hover.y - (scroller.current?.scrollTop ?? 0) + 16,
          }}
        >
          <div className="ue:truncate ue:font-medium ue:text-fg">{hover.b.name}</div>
          <div className="ue:mt-0.5 ue:grid ue:grid-cols-[auto_auto] ue:gap-x-3 ue:font-mono ue:text-subtle">
            <span>{t('包含')}</span>
            <span className={cn('ue:text-right', hover.b.ms > budget ? 'ue:text-danger' : 'ue:text-fg')}>
              {fmtMs(hover.b.ms)}
            </span>
            <span>{t('开始')}</span>
            <span className="ue:text-right">{fmtAt(hover.b.time)}</span>
            <span>{t('深度')}</span>
            <span className="ue:text-right">{hover.b.depth}</span>
          </div>
        </div>
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
