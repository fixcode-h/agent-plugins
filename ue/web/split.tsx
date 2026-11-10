import { useRef, useState, type CSSProperties } from 'react'
import { h, t } from './host.ts'

/**
 * 可拖动的分栏宽度（照面板 web/src/components/ui/resize.tsx 的 usePaneWidth / ResizeHandle，插件不能 import 面板源码，
 * 这里按同样的手感和样式写一份）。宽度记在本机 localStorage，下次打开还是这个宽度；没拖过时用 def（可以是百分比），
 * 窗口多宽都按比例分。双击拖动条恢复默认。
 */
function stored(key: string) {
  try {
    return Number(localStorage.getItem(`ue:pane:${key}`)) || 0
  } catch {
    return 0
  }
}

export function usePane(key: string, def: string, min: number) {
  const [w, setW] = useState(() => stored(key) || undefined)
  const [dragging, setDragging] = useState(false)
  const save = (n: number | undefined) => {
    try {
      if (n) localStorage.setItem(`ue:pane:${key}`, String(Math.round(n)))
      else localStorage.removeItem(`ue:pane:${key}`)
    } catch {}
  }
  /** 写进 CSS 变量的宽度：拖过用像素，没拖过用默认值 */
  const size = w ? `${w}px` : def
  return {
    size,
    min,
    dragging,
    setDragging,
    set: (n: number) => setW(Math.round(n)),
    save,
    reset: () => {
      setW(undefined)
      save(undefined)
    },
    /** 放到栏上的 style：宽度和上限走 CSS 变量，只在大屏分栏时生效（窄屏上下排，宽度不管） */
    style: (max: string) => ({ '--ue-w': size, '--ue-max': max }) as CSSProperties,
  }
}

type Pane = ReturnType<typeof usePane>

/** 分栏的外框：窄屏上下排、整块滚；lg 以上左右排，各栏自己滚（拖动条占掉卡片间距，所以 lg 上 gap 为 0） */
export const SPLIT_ROW =
  'ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-4 ue:overflow-auto ue:p-6 ue:lg:flex-row ue:lg:gap-0 ue:lg:overflow-hidden'
/** 定宽的那一栏（宽度、上限来自 usePane().style） */
export const PANE_FIXED = 'ue:shrink-0 ue:lg:w-(--ue-w) ue:lg:max-w-(--ue-max)'
/** 占满剩下宽度的那一栏 */
export const PANE_FILL = 'ue:min-w-0 ue:lg:flex-1'

/**
 * 两栏中间的拖动条。
 * - 默认放在两张卡片之间，自己占掉原来的间距（16px），中间一道 2px 的线，悬停变强调色；只在 lg 以上分栏时出现。
 * - edge：贴在侧栏右边缘（父元素要 relative），md 以上出现，用于 UE 页最左边的分区栏。
 * paneRef 指向被拖的那一栏：开始拖时量它现在的实际宽度（默认值可能是百分比）。
 * side：被拖的栏在拖动条哪一边；在右边（例如控制台的变量栏）往左拖变宽。
 * reserve：同一行里其他东西至少要留的宽度，拖动上限 = 容器内宽 - reserve，和 CSS 上限算法一致。
 */
export function SplitHandle({
  pane,
  paneRef,
  side = 'left',
  reserve,
  edge,
}: {
  pane: Pane
  paneRef: { current: HTMLElement | null }
  side?: 'left' | 'right'
  reserve: () => number
  edge?: boolean
}) {
  const { cn } = h()
  const start = useRef<{ x: number; w: number; max: number } | null>(null)
  const dir = side === 'left' ? 1 : -1
  const limits = () => {
    const box = paneRef.current?.parentElement
    if (!box) return Infinity
    const cs = getComputedStyle(box)
    return box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - reserve()
  }
  const clamp = (n: number, max: number) => Math.max(pane.min, Math.min(Math.max(pane.min, max), n))
  const nudge = (d: number) => {
    const cur = paneRef.current?.getBoundingClientRect().width ?? 0
    pane.set(clamp(cur + d, limits()))
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('拖动调整宽度')}
      tabIndex={0}
      title={t('拖动调整宽度，双击恢复默认')}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, w: paneRef.current?.getBoundingClientRect().width ?? 0, max: limits() }
        pane.setDragging(true)
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (s) pane.set(clamp(s.w + dir * (e.clientX - s.x), s.max))
      }}
      onPointerUp={(e) => {
        const s = start.current
        if (!s) return
        start.current = null
        pane.setDragging(false)
        const n = clamp(s.w + dir * (e.clientX - s.x), s.max)
        pane.set(n)
        pane.save(n)
      }}
      onDoubleClick={pane.reset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10
        if (e.key === 'ArrowLeft') nudge(-dir * step)
        else if (e.key === 'ArrowRight') nudge(dir * step)
        else return
        e.preventDefault()
      }}
      onKeyUp={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
          pane.save(paneRef.current?.getBoundingClientRect().width ?? undefined)
      }}
      className={cn(
        'ue:group ue:cursor-col-resize ue:outline-none',
        edge
          ? 'ue:absolute ue:inset-y-0 ue:-right-[3px] ue:z-20 ue:hidden ue:w-[6px] ue:md:block'
          : 'ue:relative ue:hidden ue:w-4 ue:shrink-0 ue:self-stretch ue:lg:block',
      )}
    >
      <span
        className={cn(
          'ue:absolute ue:inset-y-0 ue:w-[2px] ue:transition-colors',
          edge ? 'ue:right-[2px]' : 'ue:left-[7px] ue:rounded-full',
          pane.dragging ? 'ue:bg-accent' : 'ue:group-hover:bg-accent/60 ue:group-focus-visible:bg-accent/60',
        )}
      />
      {/* 拖动时盖一层透明遮罩：鼠标经过属性表、截图时不丢事件，光标也一直是左右箭头 */}
      {pane.dragging && <span className="ue:fixed ue:inset-0 ue:z-50 ue:cursor-col-resize" />}
    </div>
  )
}
