import { Copy, Flame, Scan, X, ZoomIn } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../host.ts'
import { readTheme, setup, useThemeTick, useWidth } from './canvas.ts'
import { copyText, openMenu } from './menu.tsx'
import { fmtAt, fmtMs } from './parts.tsx'
import type { Bookmark, Range } from './trace.ts'

/**
 * 整份 trace 的帧条（Insights 的 Frames 面板）：每个像素画这一列里最慢的那帧，尖峰不会被平均掉。
 * 拖选一段 = 设置分析范围（右栏的计时器、调用树跟着变，时间轴缩放到这一段）；点一下 = 选中那一帧；双击 = 回到整段。
 * 时间轴当前看的窗口用一个框标出来。右边照 Insights 标出 60 / 30 / 20 / 10 fps 的刻度线；右键有菜单。
 */
/** 纵轴参考线：帧时间和对应的 fps */
const FPS_LINES = [
  { ms: 1000 / 60, fps: 60 },
  { ms: 1000 / 30, fps: 30 },
  { ms: 50, fps: 20 },
  { ms: 100, fps: 10 },
]
export function FrameStrip({
  start,
  ms,
  duration,
  range,
  view,
  marks,
  budget,
  onRange,
  onZoom,
}: {
  start: number[]
  ms: number[]
  duration: number
  range?: Range
  view: Range
  marks: Bookmark[]
  budget: { target: number; unacceptable: number }
  onRange: (r: Range | undefined) => void
  onZoom: (r: Range) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const w = useWidth(el)
  const theme = useThemeTick()
  const [drag, setDrag] = useState<{ a: number; b: number }>()
  const [hover, setHover] = useState<{ x: number; i: number }>()
  const H = 96
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
    // fps 参考线：细的实线 + 右边的读数（不和预算线重复）
    g.font = `10px ${getComputedStyle(c).fontFamily || 'sans-serif'}`
    g.textBaseline = 'middle'
    g.textAlign = 'right'
    for (const l of FPS_LINES) {
      if (l.ms > cap) continue
      const ly = Math.round(y(l.ms)) + 0.5
      g.strokeStyle = th.line
      g.globalAlpha = 0.8
      g.beginPath()
      g.moveTo(0, ly)
      g.lineTo(w, ly)
      g.stroke()
      g.globalAlpha = 1
    }
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
    // fps 读数最后画、垫底色：不被预算虚线划过去
    g.setLineDash([])
    g.textAlign = 'right'
    for (const l of FPS_LINES) {
      if (l.ms > cap) continue
      const ly = Math.round(y(l.ms)) + 0.5
      const label = `${l.ms.toFixed(l.ms % 1 ? 2 : 0)} ms (${l.fps} fps)`
      const lw = g.measureText(label).width + 6
      g.fillStyle = th.card
      g.globalAlpha = 0.9
      g.fillRect(w - lw - 2, ly - 6, lw, 12)
      g.globalAlpha = 1
      g.fillStyle = th.subtle
      g.fillText(label, w - 5, ly)
    }
    g.textAlign = 'left'
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
        if (e.button !== 0) return
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
      onContextMenu={(e) => {
        if (!start.length) return
        const i = frameAt(at(local(e)))
        const fr = { t0: start[i], t1: start[i] + ms[i] / 1000 }
        let worst = 0
        for (let k = 1; k < ms.length; k++) if (ms[k] > ms[worst]) worst = k
        const near = { t0: start[Math.max(0, i - 30)], t1: start[Math.min(start.length - 1, i + 30)] }
        setHover(undefined)
        openMenu(e, [
          { title: `${t('第 {n} 帧', { n: i })} · ${fmtMs(ms[i])} · ${(1000 / Math.max(ms[i], 1e-6)).toFixed(0)} fps` },
          { label: t('把这一帧设为分析范围'), icon: Scan, onClick: () => onRange(fr) },
          { label: t('时间轴缩放到这一帧'), icon: ZoomIn, onClick: () => onZoom(fr) },
          { label: t('前后 30 帧设为分析范围'), onClick: () => onRange(near) },
          'sep',
          {
            label: t('跳到最慢的一帧'),
            icon: Flame,
            hint: fmtMs(ms[worst]),
            onClick: () => {
              const r = { t0: start[worst], t1: start[worst] + ms[worst] / 1000 }
              onRange(r)
              onZoom(r)
            },
          },
          range && { label: t('清除分析范围'), icon: X, hint: t('双击'), onClick: () => onRange(undefined) },
          'sep',
          {
            label: t('复制这一帧'),
            icon: Copy,
            onClick: () => copyText(`Frame ${i} @ ${fmtAt(start[i])} · ${fmtMs(ms[i])}`),
          },
        ])
      }}
      title={t('拖选一段设为分析范围，点一下选中一帧，双击回到整段')}
    >
      <canvas ref={cv} className="ue:block" />
      {hover && !drag && start[hover.i] !== undefined && (
        <div
          className="ue:pointer-events-none ue:absolute ue:top-1 ue:z-10 ue:rounded-md ue:border ue:border-line ue:bg-card ue:px-2 ue:py-1 ue:font-mono ue:text-caption ue:whitespace-nowrap ue:text-fg ue:shadow-md ue:motion-safe:animate-fade"
          style={{ left: Math.min(hover.x + 10, Math.max(0, w - 260)) }}
        >
          {t('第 {n} 帧', { n: hover.i })} · {fmtMs(ms[hover.i])}
          <span className="ue:ml-1 ue:text-subtle">
            {(1000 / Math.max(ms[hover.i], 1e-6)).toFixed(0)} fps @ {fmtAt(start[hover.i])}
          </span>
          {ms[hover.i] > budget.unacceptable && <span className="ue:ml-1 ue:text-danger">{t('卡顿')}</span>}
        </div>
      )}
    </div>
  )
}
