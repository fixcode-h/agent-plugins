/**
 * 表格页按住鼠标拖：拖选一块格子、在行号上拖选几行、在列名上拖选几列、拖填充柄。
 * 鼠标拖到表格边上或拖出去时，按离边的距离加速滚动（像 Excel），选区跟着滚出来的格子走。
 * 鼠标停着不动、表格自己在滚时 mouseenter 不会再来，所以每一帧按鼠标坐标问「这里是哪一格」（grid-dom.ts）。
 */
import { useCallback, useEffect, useRef } from 'react'
import { cellAt, edgeSpeed, gridArea } from './grid-dom'

export type DragKind = 'cells' | 'rows' | 'cols' | 'fill'

export interface DragPoint {
  /** 鼠标下（拖出去时是最近的边上）的那一格；没画出来的地方是 null */
  r: number | null
  c: number | null
  x: number
  y: number
  /** 按着 Ctrl / ⌘（填充柄：复制和递增对调） */
  ctrl: boolean
}

interface DragState {
  kind: DragKind
  x: number
  y: number
  ctrl: boolean
  /** 从钉在顶上的表头里开始拖的：在表头里拖不往上滚，直接选表头的格子 */
  inHead: boolean
  frame: number
  /** 上一次自动滚的时间：滚多少按经过的时间算，高刷新率的屏幕不会滚得更快 */
  last: number
}

export function useDragSelect(
  box: React.RefObject<HTMLDivElement | null>,
  onMove: (kind: DragKind, p: DragPoint) => void,
  onEnd: (kind: DragKind, p: DragPoint) => void,
) {
  const st = useRef<DragState | null>(null)
  // 回调每次渲染都换新的（里面读最新的选区），存进 ref，拖的过程中不用重新挂监听
  const cb = useRef({ onMove, onEnd })
  cb.current = { onMove, onEnd }
  const stopRef = useRef<() => void>(() => {})

  const point = (s: DragState): DragPoint => {
    const el = box.current
    const at = el ? cellAt(el, s.x, s.y, s.inHead) : { r: null, c: null }
    return { ...at, x: s.x, y: s.y, ctrl: s.ctrl }
  }

  const tick = () => {
    const s = st.current
    const el = box.current
    if (!s || !el) return
    s.frame = 0
    const a = gridArea(el, s.inHead)
    // 选整行时只上下滚、选整列时只左右滚
    const vy = s.kind === 'cols' ? 0 : edgeSpeed(s.y, a.top, a.bottom)
    const vx = s.kind === 'rows' ? 0 : edgeSpeed(s.x, a.left, a.right)
    const now = performance.now()
    // 每次重新开始滚按一帧算；中间卡了一下也最多按 50 毫秒补，免得一下子窜出去
    const k = s.last ? Math.min(50, now - s.last) / 16.7 : 1
    s.last = vx || vy ? now : 0
    if (vy) el.scrollTop += Math.round(vy * k)
    if (vx) el.scrollLeft += Math.round(vx * k)
    cb.current.onMove(s.kind, point(s))
    // 还在边上就接着滚；滚到头了（scrollTop 不再变）浏览器自己会停住，这里照样每帧问一次，开销只是一次 elementFromPoint
    if (vx || vy) s.frame = requestAnimationFrame(tick)
  }

  const start = useCallback(
    (kind: DragKind, e: React.MouseEvent) => {
      stopRef.current()
      const s: DragState = {
        kind,
        x: e.clientX,
        y: e.clientY,
        ctrl: e.ctrlKey || e.metaKey,
        // 拖列名时按数据区里的格子认列（列名格上没有 data-c），所以不算在表头里
        inHead: kind !== 'cols' && !!(e.target as HTMLElement).closest('[data-sheet-head]'),
        frame: 0,
        last: 0,
      }
      st.current = s
      const move = (ev: MouseEvent) => {
        s.x = ev.clientX
        s.y = ev.clientY
        s.ctrl = ev.ctrlKey || ev.metaKey
        if (!s.frame) s.frame = requestAnimationFrame(tick)
      }
      const up = (ev: MouseEvent) => {
        s.x = ev.clientX
        s.y = ev.clientY
        s.ctrl = ev.ctrlKey || ev.metaKey
        stop()
        // 拖得快时最后一帧还没来得及跑就松手了：先按松手的位置更新一次选区
        const end = point(s)
        cb.current.onMove(kind, end)
        cb.current.onEnd(kind, end)
      }
      const stop = () => {
        if (s.frame) cancelAnimationFrame(s.frame)
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        document.body.style.cursor = ''
        if (st.current === s) st.current = null
        stopRef.current = () => {}
      }
      stopRef.current = stop
      // 拖填充柄时整页都是十字光标（鼠标离开那个小方块也一样）
      if (kind === 'fill') document.body.style.cursor = 'crosshair'
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    // tick、point 只读 ref
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [box],
  )

  // 拖到一半表格没了（切了文件）：收掉监听
  useEffect(() => () => stopRef.current(), [])

  return { start, dragging: () => st.current?.kind ?? null }
}
