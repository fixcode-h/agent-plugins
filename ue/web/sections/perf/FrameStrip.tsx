import { Copy, Flame, Maximize2, Scan, X, ZoomIn } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { h, t } from '../../host.ts'
import { readTheme, setup, useThemeTick, useWidth } from './canvas.ts'
import { copyText, openMenu } from '@panel/web/src/components/ui/item-menu'
import { frameIndex, type LuaFrames } from './lua-trace.ts'
import { fmtAt, fmtMs } from './parts.tsx'
import type { Bookmark, Range } from './trace.ts'
import { WinScrollbar } from './ZoomControls.tsx'
import { clampWin, isWhole, panBy, useWheelZoom } from './zoom.ts'

/**
 * 整份 trace 的帧条（Insights 的 Frames 面板；样式照 Lua 性能 Insights 化效果图，用户 2026-11-17 定替换原来的帧条）：
 * 每帧一根柱子，灰色是帧时间、超过预算的偏红；trace 里有 Lua 计数器时柱子底部叠一段 Lua 用时（强调色）。
 * 帧比像素还窄时一列只画这一列里最慢的那帧（尖峰不会被平均掉），Lua 段取同一帧的。
 * 右边 30 / 60 fps 两条虚线带读数；选中的帧描边；时间轴当前的窗口用强调色的框标出来。
 * 操作和时间轴一致（用户 2026-11-17 要求）：左键拖动平移、左键单击看这一帧（时间轴跳过去）、右键拖动框选分析范围、
 * 右键单击不拖出菜单（移动超过 4 像素才算拖），滚轮缩放、双击回到整段。缩放窗口 win 由外面持有，和标题栏的按钮组共用一份。
 */
const FPS_LINES = [
  { ms: 1000 / 60, fps: 60 },
  { ms: 1000 / 30, fps: 30 },
]
/** 按下到松开移动超过这么多像素算拖动，否则算单击 */
const DRAG_PX = 4

export function FrameStrip({
  start,
  ms,
  duration,
  range,
  view,
  win,
  marks,
  budget,
  lua,
  selected,
  onFrame,
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
  /** 每帧的 Lua 读数（trace 含 Lua 时才有） */
  lua?: LuaFrames
  /** 选中的帧号（描边） */
  selected?: number
  /** 单击一帧：选中并让时间轴跳过去 */
  onFrame: (i: number) => void
  onRange: (r: Range | undefined) => void
  onZoom: (r: Range) => void
  onWin: (r: Range) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const w = useWidth(el)
  const theme = useThemeTick()
  /** 右键拖着框的那一段 */
  const [drag, setDrag] = useState<{ a: number; b: number }>()
  const [hover, setHover] = useState<{ x: number; i: number }>()
  // 按下时记住按的哪个键和起点：动过 4px 才算拖（左键平移、右键框选），没动就是单击 / 右键菜单
  const press = useRef<{ x: number; win: Range; at: number; moved: boolean; button: number } | null>(null)
  const [panning, setPanning] = useState(false)
  useWheelZoom(el, win, duration, onWin)
  const H = 88
  const top = 8
  const span = Math.max(win.t1 - win.t0, 1e-9)
  const x = (s: number) => ((s - win.t0) / span) * w
  const at = (px: number) => Math.max(0, Math.min(duration, win.t0 + (px / Math.max(w, 1)) * span))
  // 纵轴：最慢那帧顶到接近满格，但至少露出 30 fps 线、最多到不可接受阈值的 1.8 倍（一次长卡顿不会把其余的帧压扁）
  const cap = Math.max(
    budget.target * 1.3,
    Math.min(Math.max(...ms.slice(0, 50000), 1) * 1.08, budget.unacceptable * 1.8),
  )
  const frameAt = (s: number) => frameIndex(start, s)

  useEffect(() => {
    const c = cv.current
    if (!c || !w) return
    const g = setup(c, w, H)
    const th = readTheme(c)
    const y = (v: number) => H - 1 - (Math.min(v, cap) / cap) * (H - top - 2)
    // 每列记最慢那帧的帧号；一帧够宽时画成一根带缝的柱子
    const cols = new Int32Array(w).fill(-1)
    const i0 = frameAt(win.t0)
    const i1 = frameAt(win.t1)
    for (let i = i0; i <= i1 && i < ms.length; i++) {
      const a = x(start[i])
      const b = x(start[i] + ms[i] / 1000)
      if (b < 0 || a >= w) continue
      const c0 = Math.max(0, Math.floor(a))
      const c1 = Math.min(w - 1, Math.floor(b) - c0 >= 3 ? Math.floor(b) - 1 : c0)
      for (let k = c0; k <= c1; k++) if (cols[k] < 0 || ms[i] > ms[cols[k]]) cols[k] = i
    }
    for (let k = 0; k < w; k++) {
      const i = cols[k]
      if (i < 0) continue
      const v = ms[i]
      const over = v > budget.target
      g.fillStyle = over ? th.danger : th.subtle
      g.globalAlpha = over ? 0.7 : th.dark ? 0.5 : 0.45
      g.fillRect(k, y(v), 1, H - 1 - y(v))
      const l = lua?.ms[i]
      if (l) {
        g.fillStyle = th.accent
        g.globalAlpha = 0.85
        const ly = y(Math.min(l, v))
        g.fillRect(k, ly, 1, H - 1 - ly)
      }
    }
    g.globalAlpha = 1
    // 30 / 60 fps 两条虚线，右边垫底色写读数
    g.font = `10px ${getComputedStyle(c).fontFamily || 'sans-serif'}`
    g.textBaseline = 'middle'
    g.textAlign = 'right'
    g.setLineDash([3, 3])
    g.lineWidth = 1
    for (const l of FPS_LINES) {
      const ly = Math.round(y(l.ms)) + 0.5
      g.strokeStyle = th.muted
      g.globalAlpha = 0.5
      g.beginPath()
      g.moveTo(0, ly)
      g.lineTo(w, ly)
      g.stroke()
      g.globalAlpha = 1
    }
    g.setLineDash([])
    for (const l of FPS_LINES) {
      const ly = Math.round(y(l.ms)) + 0.5
      const label = `${l.ms.toFixed(1)} ms · ${l.fps} fps`
      const lw = g.measureText(label).width + 6
      g.fillStyle = th.card
      g.globalAlpha = 0.9
      g.fillRect(w - lw - 2, ly - 11, lw, 11)
      g.globalAlpha = 1
      g.fillStyle = th.subtle
      g.fillText(label, w - 5, ly - 5.5)
    }
    g.textAlign = 'left'
    // 书签：顶上一个小三角
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
    // 分析范围（或正在右键框的那段）：范围外压暗
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
    // 选中的帧：整根柱子描边（窄到一两个像素时也至少 3px 宽，看得见）
    if (selected !== undefined && start[selected] !== undefined) {
      const a = x(start[selected])
      const b = x(start[selected] + ms[selected] / 1000)
      if (b >= -2 && a <= w + 2) {
        const sw = Math.max(3, b - a)
        const sx = (a + b) / 2 - sw / 2
        const sy = y(ms[selected])
        g.strokeStyle = th.fg
        g.lineWidth = 1.5
        g.strokeRect(Math.round(sx) - 0.25, Math.round(sy) - 1.25, Math.round(sw) + 0.5, H - sy + 0.5)
      }
    }
    // 时间轴当前的窗口：强调色边框 + 很淡的底（帧条放大后可能只露出一部分或整个在窗口外）
    const vx0 = x(view.t0)
    const vx1 = x(view.t1)
    if (vx1 >= 0 && vx0 <= w) {
      const a = Math.max(-2, vx0)
      const b = Math.min(w + 2, vx1)
      const bw = Math.max(4, b - a)
      const bx = b - a < 4 ? (a + b) / 2 - 2 : a
      g.fillStyle = th.accent
      g.globalAlpha = 0.08
      g.fillRect(bx, 0, bw, H)
      g.globalAlpha = 1
      g.strokeStyle = th.accent
      g.lineWidth = 1.5
      g.strokeRect(Math.round(bx) + 0.5, 0.75, Math.round(bw), H - 1.5)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- 画布按这些值重画；x / cap / frameAt 由它们算出
  }, [w, start, ms, duration, range, view, win, marks, drag, theme, budget.target, lua, selected])

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
      { label: t('时间轴缩放到这一帧'), icon: ZoomIn, hint: t('单击'), onClick: () => onFrame(i) },
      { label: t('前后 30 帧设为分析范围'), onClick: () => onRange(near) },
      'sep',
      {
        label: t('跳到最慢的一帧'),
        icon: Flame,
        hint: fmtMs(ms[worst]),
        onClick: () => {
          onRange({ t0: start[worst], t1: start[worst] + ms[worst] / 1000 })
          onFrame(worst)
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
        onClick: () =>
          copyText(
            `Frame ${i} @ ${fmtAt(start[i])} · ${fmtMs(ms[i])}${lua?.ms[i] ? ` · Lua ${fmtMs(lua.ms[i])}` : ''}`,
          ),
      },
    ])
  }

  const hi = hover && start[hover.i] !== undefined ? hover.i : undefined
  const luaMs = hi !== undefined ? lua?.ms[hi] : undefined
  return (
    <>
      <div
        ref={(n) => {
          box.current = n
          setEl(n)
        }}
        className={h().cn('ue:relative ue:select-none', panning ? 'ue:cursor-grabbing' : 'ue:cursor-default')}
        style={{ height: H }}
        onPointerDown={(e) => {
          if (e.button > 2) return
          // 中键顺带拦住浏览器的自动滚动
          if (e.button === 1) e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          press.current = { x: e.clientX, win, at: at(local(e)), moved: false, button: e.button }
        }}
        onPointerMove={(e) => {
          const px = local(e)
          const p = press.current
          if (p) {
            const dx = e.clientX - p.x
            if (!p.moved && Math.abs(dx) <= DRAG_PX) return
            if (!p.moved) {
              p.moved = true
              setHover(undefined)
              if (p.button !== 2) setPanning(true)
            }
            // 右键拖：框选分析范围；左键、中键拖：平移
            if (p.button === 2) setDrag({ a: p.at, b: at(px) })
            else onWin(panBy(p.win, (-dx / Math.max(w, 1)) * (p.win.t1 - p.win.t0), duration))
            return
          }
          if (start.length) setHover({ x: px, i: frameAt(at(px)) })
        }}
        onPointerLeave={() => setHover(undefined)}
        onPointerUp={(e) => {
          const p = press.current
          press.current = null
          setPanning(false)
          if (!p) return
          if (p.button === 2) {
            if (!p.moved) return menu(e)
            const d = drag
            setDrag(undefined)
            if (d && Math.abs(x(d.b) - x(d.a)) >= 3) onRange({ t0: Math.min(d.a, d.b), t1: Math.max(d.a, d.b) })
            return
          }
          // 左键单击：选中那一帧，时间轴跳过去
          if (p.button === 0 && !p.moved && start.length) onFrame(frameAt(p.at))
        }}
        onPointerCancel={() => {
          press.current = null
          setPanning(false)
          setDrag(undefined)
        }}
        onDoubleClick={() => onRange(undefined)}
        onContextMenu={(e) => {
          // 鼠标右键的菜单在松开时由 onPointerUp 弹；这里只接键盘（菜单键、Shift+F10）
          e.preventDefault()
          if (press.current || e.button === 2) return
          menu(e)
        }}
        title={t('左键拖动平移，单击看这一帧，右键拖选分析范围，右键单击出菜单；滚轮缩放，双击回到整段')}
      >
        <canvas ref={cv} className="ue:block" />
        {hi !== undefined && !drag && (
          <div
            className="ue:pointer-events-none ue:absolute ue:top-1 ue:z-10 ue:rounded-md ue:border ue:border-line ue:bg-card ue:px-2 ue:py-1 ue:font-mono ue:text-caption ue:whitespace-nowrap ue:text-fg ue:shadow-md ue:motion-safe:animate-fade"
            style={{ left: Math.min(hover!.x + 10, Math.max(0, w - 280)) }}
          >
            <div>
              {t('第 {n} 帧', { n: hi })} · {fmtMs(ms[hi])}
              <span className="ue:ml-1 ue:text-subtle">
                {(1000 / Math.max(ms[hi], 1e-6)).toFixed(0)} fps @ {fmtAt(start[hi])}
              </span>
              {ms[hi] > budget.unacceptable && <span className="ue:ml-1 ue:text-danger">{t('卡顿')}</span>}
            </div>
            {lua && (
              <div className="ue:text-accent-text">
                {t('其中 Lua {ms}（{pct}%）', {
                  ms: fmtMs(luaMs ?? 0),
                  pct: (((luaMs ?? 0) / Math.max(ms[hi], 1e-6)) * 100).toFixed(0),
                })}
                {lua.calls[hi] > 0 && (
                  <span className="ue:ml-1 ue:text-subtle">
                    · {t('调用 {n} 次', { n: Math.round(lua.calls[hi]).toLocaleString() })}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <WinScrollbar win={win} duration={duration} onWin={onWin} />
    </>
  )
}
