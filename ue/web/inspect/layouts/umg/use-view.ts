import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { actualSize, clampPan, fitView, stepZoom, wheelSteps, zoomAt, type View } from './view.ts'

/** 存盘的视图：适应屏幕（随画布大小重算），或者固定的缩放和位置 */
type Saved = { fit: true } | { fit: false; v: View }

const FIT: Saved = { fit: true }

function load(key: string): Saved {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return FIT
    const v = JSON.parse(raw) as Partial<View>
    if ([v.k, v.x, v.y].every((n) => typeof n === 'number' && Number.isFinite(n))) return { fit: false, v: v as View }
  } catch {}
  return FIT
}

function save(key: string, s: Saved) {
  try {
    if (s.fit) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify({ k: s.v.k, x: Math.round(s.v.x), y: Math.round(s.v.y) }))
  } catch {}
}

/** 按下右键或中键后拖多远才算平移（像素）：只按不拖不动画面 */
const DRAG_START = 3

/**
 * 设计器画布的缩放和平移（照 UE 控件蓝图设计器）：
 * 滚轮以光标为中心按档缩放；右键或中键按住拖动平移；Home 缩放到适合。
 * 缩放和位置按资源记在本机（localStorage，读写失败就当没有，回到适应屏幕）。
 */
export function useDesignerView(
  stage: RefObject<HTMLDivElement | null>,
  storeKey: string,
  size: { w: number; h: number },
) {
  const [saved, setSaved] = useState<Saved>(() => load(storeKey))
  const [room, setRoom] = useState({ w: 800, h: 450 })
  const [panning, setPanning] = useState(false)
  const loaded = useRef(storeKey)
  if (loaded.current !== storeKey) {
    // 换了资源：读这个资源记下的视图（渲染中同步换，避免先用上一个资源的位置画一帧）
    loaded.current = storeKey
    setSaved(load(storeKey))
  }

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [stage])

  // 拖动、滚轮时写得很频繁：停下 300 毫秒后再写盘
  useEffect(() => {
    const id = setTimeout(() => save(storeKey, saved), 300)
    return () => clearTimeout(id)
  }, [saved, storeKey])

  const view: View = saved.fit ? fitView(room, size) : clampPan(saved.v, room, size)
  const cur = useRef({ view, room, size })
  cur.current = { view, room, size }
  const set = (v: View) => setSaved({ fit: false, v: clampPan(v, cur.current.room, cur.current.size) })

  // 滚轮要 preventDefault（不然整页跟着滚），React 的 onWheel 是被动监听做不到，只能原生挂
  const acc = useRef(0)
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = wheelSteps(acc.current, e.deltaY, e.deltaMode)
      acc.current = r.acc
      if (!r.steps) return
      const { view: v } = cur.current
      let k = v.k
      for (let i = 0; i < Math.abs(r.steps); i++) k = stepZoom(k, r.steps)
      const b = el.getBoundingClientRect()
      set(zoomAt(v, k, e.clientX - b.left, e.clientY - b.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // set 只读 cur 里的最新值，挂一次就够
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  const drag = useRef<{ id: number; sx: number; sy: number; v0: View; moved: boolean }>(undefined)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.focus({ preventScroll: true })
    if (e.button !== 1 && e.button !== 2) return
    // 中键默认会进浏览器的自动滚动，右键按下也不该选中文字
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, v0: view, moved: false }
  }
  /** 平移中返回 true（调用方这时不更新悬停） */
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return false
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < DRAG_START) return true
    if (!d.moved) {
      d.moved = true
      setPanning(true)
    }
    set({ k: d.v0.k, x: d.v0.x + dx, y: d.v0.y + dy })
    return true
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = undefined
    setPanning(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const fit = () => setSaved(FIT)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Home') {
      e.preventDefault()
      fit()
    }
  }

  return {
    view,
    room,
    fitted: saved.fit,
    panning,
    fit,
    oneToOne: () => set(actualSize(view, room)),
    /** 下拉里选的档位：以画布中心为中心 */
    setZoom: (k: number) => set(zoomAt(view, k, room.w / 2, room.h / 2)),
    handlers: {
      onPointerDown,
      onPointerUp,
      onPointerCancel: onPointerUp,
      // 右键松开不弹浏览器菜单（UE 设计器里右键就是拖画布）
      onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
      onKeyDown,
    },
    onPointerMove,
  }
}
