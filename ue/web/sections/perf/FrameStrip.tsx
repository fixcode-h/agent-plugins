import { Copy, Flame, Maximize2, Scan, X, ZoomIn } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { h, t } from '../../host.ts'
import { readTheme, setup, useThemeTick, useWidth } from './canvas.ts'
import { copyText, openMenu } from './menu.tsx'
import { fmtAt, fmtMs } from './parts.tsx'
import type { Bookmark, Range } from './trace.ts'
import { WinScrollbar } from './ZoomControls.tsx'
import { clampWin, isWhole, panBy, useWheelZoom } from './zoom.ts'

/**
 * 整份 trace 的帧条（Insights 的 Frames 面板）：每个像素画这一列里最慢的那帧，尖峰不会被平均掉。
 * 拖选一段 = 设置分析范围（右栏的计时器、调用树跟着变，时间轴缩放到这一段）；点一下 = 选中那一帧；双击 = 回到整段。
 * 时间轴当前看的窗口用一个框标出来。右边照 Insights 标出 60 / 30 / 20 / 10 fps 的刻度线；右键有菜单。
 * 帧条自己也能缩放（照 Insights）：滚轮以鼠标处为中心缩放，右键或中键拖动、Shift + 滚轮、底部滑块左右平移；
 * 缩放窗口 win 由外面持有，标题栏的按钮组（ZoomControls）和这里改的是同一份。放大到一帧占几个像素时每帧画成一根带间隙的柱子。
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
  win,
  marks,
  budget,
  onRange,
  onZoom,
  onWin,
}: {
  start: number[]
  ms: number[]
  duration: number
  range?: Range
  view: Range
  /** 帧条自己的缩放窗口（不是时间轴的 view） */
  win: Range
  marks: Bookmark[]
  budget: { target: number; unacceptable: number }
  onRange: (r: Range | undefined) => void
  onZoom: (r: Range) => void
  onWin: (r: Range) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const w = useWidth(el)
  const theme = useThemeTick()
  const [drag, setDrag] = useState<{ a: number; b: number }>()
  const [hover, setHover] = useState<{ x: number; i: number }>()
  // 右键 / 中键按下后的平移：动过 4px 才算拖，没动就是右键菜单
  const pan = useRef<{ x: number; win: Range; moved: boolean; button: number } | null>(null)
  const [panning, setPanning] = useState(false)
  useWheelZoom(el, win, duration, onWin)
  const H = 96
  const top = 14
  const span = Math.max(win.t1 - win.t0, 1e-9)
  const x = (s: number) => ((s - win.t0) / span) * w
  const at = (px: number) => Math.max(0, Math.min(duration, win.t0 + (px / Math.max(w, 1)) * span))
  // 纵轴封顶在不可接受阈值的 1.8 倍：一次长卡顿不会把其余的帧压扁
  const cap = Math.max(budget.unacceptable * 1.8, Math.min(Math.max(...ms.slice(0, 50000), 1), budget.unacceptable * 4))

  useEffect(() => {
    const c = cv.current
    if (!c || !w) return
    const g = setup(c, w, H)
    const th = readTheme(c)
    const y = (v: number) => H - 2 - (Math.min(v, cap) / cap) * (H - top - 4)
    // 每列取最慢的帧；只扫窗口里的帧（二分找起止），放大后平移、滚轮不用每次扫整份 trace
    const cols = new Float32Array(w)
    const i0 = frameAt(win.t0)
    const i1 = frameAt(win.t1)
    for (let i = i0; i <= i1 && i < ms.length; i++) {
      const a = x(start[i])
      const b = x(start[i] + ms[i] / 1000)
      if (b < 0 || a >= w) continue
      const c0 = Math.max(0, Math.floor(a))
      // 一帧宽过 3px 时画满它的宽度、右边留 1~2px 缝，看得出一帧一帧；更窄时只占一列
      const c1 = Math.min(w - 1, Math.floor(b) - c0 >= 3 ? Math.floor(b) - 2 : c0)
      for (let c = c0; c <= c1; c++) if (ms[i] > cols[c]) cols[c] = ms[i]
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
      if (mx < -3 || mx > w + 3) continue
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
      const a = Math.max(0, Math.min(w, x(r.t0)))
      const b = Math.max(0, Math.min(w, x(r.t1)))
      g.fillRect(0, 0, a, H)
      g.fillRect(b, 0, w - b, H)
      g.globalAlpha = 1
    }
    // 时间轴当前的窗口（帧条放大后可能只露出一部分或整个在窗口外）
    const vx0 = x(view.t0)
    const vx1 = x(view.t1)
    if (vx1 >= 0 && vx0 <= w) {
      g.strokeStyle = th.accent
      g.lineWidth = 1.5
      const a = Math.max(-2, vx0)
      const b = Math.min(w + 2, vx1)
      g.strokeRect(Math.round(a) + 0.5, 0.75, Math.max(2, b - a), H - 1.5)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- 画布按这些值重画；x / cap / frameAt 由它们算出
  }, [w, start, ms, duration, range, view, win, marks, drag, theme, budget.target, budget.unacceptable])

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

  /** 右键菜单：右键没拖动就松开时弹（Windows 上 contextmenu 本来就在松开时触发，这样别的系统也一致） */
  const menu = (e: MouseEvent) => {
    if (!start.length) return
    const i = frameAt(at(local(e)))
    const fr = { t0: start[i], t1: start[i] + ms[i] / 1000 }
    let worst = 0
    for (let k = 1; k < ms.length; k++) if (ms[k] > ms[worst]) worst = k
    const near = { t0: start[Math.max(0, i - 30)], t1: start[Math.min(start.length - 1, i + 30)] }
    // 帧条放大到某一段：两边各留 5%，最慢那帧不贴边
    const stripTo = (r: Range) => {
      const pad = Math.max((r.t1 - r.t0) * 0.05, 1e-4)
      onWin(clampWin(r.t0 - pad, r.t1 + pad, duration))
    }
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
      range && { label: t('帧条放大到分析范围'), icon: ZoomIn, onClick: () => stripTo(range) },
      { label: t('帧条放大到时间轴窗口'), icon: ZoomIn, onClick: () => stripTo(view) },
      !isWhole(win, duration) && {
        label: t('帧条看整段'),
        icon: Maximize2,
        onClick: () => onWin({ t0: 0, t1: duration }),
      },
      'sep',
      {
        label: t('复制这一帧'),
        icon: Copy,
        onClick: () => copyText(`Frame ${i} @ ${fmtAt(start[i])} · ${fmtMs(ms[i])}`),
      },
    ])
  }

  return (
    <>
      <div
        ref={(n) => {
          box.current = n
          setEl(n)
        }}
        className={h().cn('ue:relative ue:select-none', panning ? 'ue:cursor-grabbing' : 'ue:cursor-crosshair')}
        style={{ height: H }}
        onPointerDown={(e) => {
          // 右键、中键：按住拖动平移（中键顺带拦住浏览器的自动滚动）
          if (e.button === 1 || e.button === 2) {
            if (e.button === 1) e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            pan.current = { x: e.clientX, win, moved: false, button: e.button }
            return
          }
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          const s = at(local(e))
          setDrag({ a: s, b: s })
        }}
        onPointerMove={(e) => {
          const px = local(e)
          const p = pan.current
          if (p) {
            const dx = e.clientX - p.x
            if (!p.moved && Math.abs(dx) < 4) return
            if (!p.moved) {
              p.moved = true
              setPanning(true)
              setHover(undefined)
            }
            onWin(panBy(p.win, (-dx / Math.max(w, 1)) * (p.win.t1 - p.win.t0), duration))
            return
          }
          if (drag) setDrag({ ...drag, b: at(px) })
          else if (start.length) setHover({ x: px, i: frameAt(at(px)) })
        }}
        onPointerLeave={() => setHover(undefined)}
        onPointerUp={(e) => {
          const p = pan.current
          if (p) {
            pan.current = null
            setPanning(false)
            if (!p.moved && p.button === 2) menu(e)
            return
          }
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
        onPointerCancel={() => {
          pan.current = null
          setPanning(false)
          setDrag(undefined)
        }}
        onDoubleClick={() => onRange(undefined)}
        onContextMenu={(e) => {
          // 鼠标右键的菜单在松开时由 onPointerUp 弹；这里只接键盘（菜单键、Shift+F10）
          e.preventDefault()
          if (pan.current || e.button === 2) return
          menu(e)
        }}
        title={t('拖选一段设为分析范围，点一下选中一帧，双击回到整段；滚轮缩放，右键拖动或 Shift + 滚轮左右平移')}
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
      <WinScrollbar win={win} duration={duration} onWin={onWin} />
    </>
  )
}
