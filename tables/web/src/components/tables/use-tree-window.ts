import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 行数到这么多才只画看得见的一段：少的时候全画，滚动、右键、键盘都和原来一样 */
const MIN_ROWS = 300
/** 看得见的上下各多画这么多行：滚快了不露白 */
const OVERSCAN = 30
/** 量不到行高时按这个算：一行 28px（tb:h-7）加 1px 行距 */
const FALLBACK_STRIDE = 29

/** 往上找第一个能纵向滚动的祖先（列表栏的滚动区） */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if (y === 'auto' || y === 'scroll') return p
  }
  return null
}

/**
 * 表格文件树的虚拟列表：几万张表全展开（或名字搜索命中几千个）时只画滚动区里看得见的那一段，上下用空白撑住高度。
 * 行高按画出来的第一行量（行高跟着字号设置走，写死会对不上），滚动区是列表栏自己的，不另加滚动条
 */
export function useTreeWindow() {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  // 树里从哪儿到哪儿看得见（相对树的顶边，px）；一开始按一屏算，挂上后马上按实际量
  const [view, setView] = useState({ top: 0, height: typeof window === 'undefined' ? 800 : window.innerHeight })
  const stride = useRef(FALLBACK_STRIDE)
  const frame = useRef(0)

  const measure = useCallback(() => {
    if (!el) return
    const row = el.querySelector<HTMLElement>('[role="treeitem"]')
    if (row) stride.current = row.getBoundingClientRect().height + 1 || FALLBACK_STRIDE
    const box = el.getBoundingClientRect()
    const scroller = scrollParent(el)
    const vp = scroller ? scroller.getBoundingClientRect() : { top: 0, height: window.innerHeight }
    const top = Math.max(0, Math.round(vp.top - box.top))
    const height = Math.round(vp.height)
    setView((v) => (v.top === top && v.height === height ? v : { top, height }))
  }, [el])

  useEffect(() => {
    if (!el) return
    const scroller = scrollParent(el)
    const target: HTMLElement | Window = scroller ?? window
    // 滚动一帧只量一次
    const onScroll = () => {
      if (frame.current) return
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        measure()
      })
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    if (scroller) ro.observe(scroller)
    ro.observe(el)
    return () => {
      target.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [el, measure])
  // 每次画完再量一次：上面的「最近打开」展开收起、页面换布局时树的位置变了，不会有滚动事件
  useLayoutEffect(measure)

  /** n 行里这次要画哪一段，以及上下要撑多高 */
  const layout = (n: number) => {
    if (n < MIN_ROWS) return { start: 0, end: n, before: 0, after: 0 }
    const s = stride.current
    const start = Math.max(0, Math.floor(view.top / s) - OVERSCAN)
    const end = Math.min(n, Math.ceil((view.top + view.height) / s) + OVERSCAN)
    return { start, end, before: start * s, after: (n - end) * s }
  }
  return { ref: setEl, layout }
}
