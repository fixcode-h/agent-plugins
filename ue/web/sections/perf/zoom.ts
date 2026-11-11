import { useEffect, useRef } from 'react'
import type { Range } from './trace.ts'

/**
 * 横向时间轴的缩放 / 平移（帧条用，照 Insights 的 Frames 面板）：
 * 滚轮以鼠标处为中心缩放，Shift + 滚轮或触控板左右滑动平移；窗口始终夹在 [0, duration] 里，不会拖出数据外面。
 * 缩放算法单独放这里，别的横向图要缩放时直接复用，不再各写一份。
 */

/** 最小能放大到多宽：整段的十万分之一，且不小于 0.2 ms（再小一帧都占满屏，没意义） */
export function minSpan(duration: number) {
  return Math.max(duration / 1e5, 0.0002)
}

/** 把窗口夹回 [0, duration]：宽度在 [minSpan, duration] 之间，越界就整体挪回来，不改宽度 */
export function clampWin(t0: number, t1: number, duration: number): Range {
  const d = Math.max(duration, 1e-9)
  const s = Math.min(Math.max(t1 - t0, minSpan(d)), d)
  const a = Math.min(Math.max(t0, 0), d - s)
  return { t0: a, t1: a + s }
}

/** 以时间 at 为不动点缩放 k 倍（k < 1 放大） */
export function zoomAround(win: Range, at: number, k: number, duration: number): Range {
  const f = (at - win.t0) / Math.max(win.t1 - win.t0, 1e-12)
  const s = (win.t1 - win.t0) * k
  return clampWin(at - f * s, at - f * s + s, duration)
}

/** 平移 dt 秒 */
export function panBy(win: Range, dt: number, duration: number): Range {
  return clampWin(win.t0 + dt, win.t1 + dt, duration)
}

/** 是不是整段（没缩放） */
export function isWhole(win: Range, duration: number) {
  return win.t0 <= 1e-9 && win.t1 >= duration - 1e-9
}

/**
 * 给元素挂滚轮缩放 / 平移。React 的 onWheel 是 passive 的，拦不住页面滚动，只能自己挂原生监听。
 * 窗口从 ref 读，挂一次就够，滚得再快也不会因为闭包拿到旧窗口而跳。
 */
export function useWheelZoom(el: HTMLElement | null, win: Range, duration: number, setWin: (r: Range) => void) {
  const ref = useRef({ win, duration, setWin })
  ref.current = { win, duration, setWin }
  useEffect(() => {
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const { win: v, duration: d, setWin: set } = ref.current
      const r = el.getBoundingClientRect()
      const span = v.t1 - v.t0
      // 触控板左右滑动、Shift + 滚轮：平移；上下滚：缩放
      const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0
      if (horiz) {
        // 已经看整段时平移没意义，把滚动还给页面
        if (isWhole(v, d)) return
        e.preventDefault()
        // 先写回 ref：两次渲染之间连着来的滚轮事件接着上一步算，不会丢步
        ref.current.win = panBy(v, (horiz / Math.max(r.width, 1)) * span, d)
        set(ref.current.win)
        return
      }
      if (!e.deltaY) return
      // 看整段时再往外滚没东西可缩：不拦，页面照常滚
      if (e.deltaY > 0 && isWhole(v, d)) return
      e.preventDefault()
      const f = (e.clientX - r.left) / Math.max(r.width, 1)
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      ref.current.win = zoomAround(v, v.t0 + f * span, Math.exp(e.deltaY * unit * 0.0015), d)
      set(ref.current.win)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [el])
}
