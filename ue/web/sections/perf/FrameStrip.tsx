import { useEffect, useRef, useState } from 'react'
import { t } from '../../host.ts'
import { readTheme, setup, useThemeTick, useWidth } from './canvas.ts'
import { fmtAt, fmtMs } from './parts.tsx'
import type { Bookmark, Range } from './trace.ts'

/**
 * 整份 trace 的帧条（Insights 的 Frames 面板）：每个像素画这一列里最慢的那帧，尖峰不会被平均掉。
 * 拖选一段 = 设置分析范围（右栏的计时器、调用树跟着变，时间轴缩放到这一段）；点一下 = 选中那一帧；双击 = 回到整段。
 * 时间轴当前看的窗口用一个框标出来。
 */
export function FrameStrip({
  start,
  ms,
  duration,
  range,
  view,
  marks,
  budget,
  onRange,
}: {
  start: number[]
  ms: number[]
  duration: number
  range?: Range
  view: Range
  marks: Bookmark[]
  budget: { target: number; unacceptable: number }
  onRange: (r: Range | undefined) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const w = useWidth(el)
  const theme = useThemeTick()
  const [drag, setDrag] = useState<{ a: number; b: number }>()
  const [hover, setHover] = useState<{ x: number; i: number }>()
  const H = 72
  const top = 14
  const x = (s: number) => (s / Math.max(duration, 1e-9)) * w
  const at = (px: number) => Math.max(0, Math.min(duration, (px / Math.max(w, 1)) * duration))
  // 纵轴封顶在不可接受阈值的 1.8 倍：一次长卡顿不会把其余的帧压扁
  const cap = Math.max(budget.unacceptable * 1.8, Math.min(Math.max(...ms.slice(0, 50000), 1), budget.unacceptable * 4))

  useEffect(() => {
    const c = cv.current
    if (!c || !w) return
    const g = setup(c, w, H)
    const th = readTheme(c)
    const y = (v: number) => H - 2 - (Math.min(v, cap) / cap) * (H - top - 4)
    // 每列取最慢的帧
    const cols = new Float32Array(w)
    for (let i = 0; i < ms.length; i++) {
      const col = Math.min(w - 1, Math.max(0, Math.floor(x(start[i]))))
      if (ms[i] > cols[col]) cols[col] = ms[i]
    }
    for (let i = 0; i < w; i++) {
      const v = cols[i]
      if (!v) continue
      g.fillStyle = v > budget.unacceptable ? th.danger : v > budget.target ? th.warning : th.success
      g.globalAlpha = v > budget.target ? 0.95 : 0.6
      g.fillRect(i, y(v), 1, H - 2 - y(v))
    }
    g.globalAlpha = 1
    g.setLineDash([3, 3])
    g.lineWidth = 1
    for (const [v, col] of [
      [budget.target, th.warning],
      [budget.unacceptable, th.danger],
    ] as const) {
      g.strokeStyle = col
      g.globalAlpha = 0.6
      g.beginPath()
      g.moveTo(0, Math.round(y(v)) + 0.5)
      g.lineTo(w, Math.round(y(v)) + 0.5)
      g.stroke()
    }
    g.globalAlpha = 1
    // 书签：顶上一个小三角
    g.setLineDash([])
    g.fillStyle = th.accent
    for (const m of marks) {
      const mx = Math.round(x(m.t))
      g.beginPath()
      g.moveTo(mx - 3, 1)
      g.lineTo(mx + 3, 1)
      g.lineTo(mx, 6)
      g.fill()
    }
    // 选中的范围：范围外压暗
    const r = drag ? { t0: Math.min(drag.a, drag.b), t1: Math.max(drag.a, drag.b) } : range
    if (r) {
      g.fillStyle = th.card
      g.globalAlpha = 0.6
      g.fillRect(0, 0, x(r.t0), H)
      g.fillRect(x(r.t1), 0, w - x(r.t1), H)
      g.globalAlpha = 1
    }
    // 时间轴当前的窗口
    g.strokeStyle = th.accent
    g.lineWidth = 1.5
    const vx = x(view.t0)
    g.strokeRect(Math.round(vx) + 0.5, 0.75, Math.max(2, x(view.t1) - vx), H - 1.5)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- 画布按这些值重画；x / cap 由它们算出
  }, [w, start, ms, duration, range, view, marks, drag, theme, budget.target, budget.unacceptable])

  /** 第几帧盖住这个时间：帧按开始时间有序，二分 */
  const frameAt = (s: number) => {
    let lo = 0
    let hi = start.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (start[mid] <= s) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const local = (e: { clientX: number }) => e.clientX - (box.current?.getBoundingClientRect().left ?? 0)

  return (
    <div
      ref={(n) => {
        box.current = n
        setEl(n)
      }}
      className="ue:relative ue:cursor-crosshair ue:select-none"
      style={{ height: H }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const s = at(local(e))
        setDrag({ a: s, b: s })
      }}
      onPointerMove={(e) => {
        const px = local(e)
        if (drag) setDrag({ ...drag, b: at(px) })
        else if (start.length) setHover({ x: px, i: frameAt(at(px)) })
      }}
      onPointerLeave={() => setHover(undefined)}
      onPointerUp={() => {
        if (!drag) return
        const a = Math.min(drag.a, drag.b)
        const b = Math.max(drag.a, drag.b)
        setDrag(undefined)
        if (x(b) - x(a) < 3) {
          // 点一下：选中那一帧
          const i = frameAt(a)
          if (start[i] !== undefined) onRange({ t0: start[i], t1: start[i] + ms[i] / 1000 })
        } else onRange({ t0: a, t1: b })
      }}
      onDoubleClick={() => onRange(undefined)}
      title={t('拖选一段设为分析范围，点一下选中一帧，双击回到整段')}
    >
      <canvas ref={cv} className="ue:block" />
      {hover && !drag && start[hover.i] !== undefined && (
        <div
          className="ue:pointer-events-none ue:absolute ue:top-1 ue:z-10 ue:rounded-md ue:border ue:border-line ue:bg-card ue:px-2 ue:py-1 ue:font-mono ue:text-caption ue:whitespace-nowrap ue:text-fg ue:shadow-md ue:motion-safe:animate-fade"
          style={{ left: Math.min(hover.x + 10, Math.max(0, w - 170)) }}
        >
          {t('第 {n} 帧', { n: hover.i })} · {fmtMs(ms[hover.i])}
          <span className="ue:ml-1 ue:text-subtle">@ {fmtAt(start[hover.i])}</span>
        </div>
      )}
    </div>
  )
}
