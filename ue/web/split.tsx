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

/** 记住的尺寸（设置 →「资源查看布局」列出、重置用）：没拖过是 0 */
export const storedPane = stored

/** 清掉记住的尺寸（设置页「重置」）：已经打开的页面下次挂载时回到默认 */
export function forgetPane(key: string) {
  try {
    localStorage.removeItem(`ue:pane:${key}`)
  } catch {}
}

/**
 * axis：x 是左右分栏的宽度（默认），y 是上下分栏的高度（usePaneHeight）。
 * 两种记在同一张表里（键不同），拖动条按 pane.axis 决定量宽还是量高
 */
export function usePane(key: string, def: string, min: number, axis: 'x' | 'y' = 'x') {
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
    axis,
    dragging,
    setDragging,
    set: (n: number) => setW(Math.round(n)),
    save,
    reset: () => {
      setW(undefined)
      save(undefined)
    },
    /** 放到栏上的 style：宽度和上限走 CSS 变量，只在大屏分栏时生效（窄屏上下排，宽度不管） */
    style: (max: string) =>
      axis === 'x'
        ? ({ '--ue-w': size, '--ue-max': max } as CSSProperties)
        : ({ '--ue-h': size, '--ue-hmax': max } as CSSProperties),
  }
}

/** 上下分栏的高度（资源查看页的动画时间轴、控件树下面的动画列表）：和 usePane 一样记在本机、双击恢复 */
export const usePaneHeight = (key: string, def: string, min: number) => usePane(key, def, min, 'y')

type Pane = ReturnType<typeof usePane>

/**
 * 分栏的外框：栏和栏贴边、中间一道细线（用户 2026-11-11：不要圆角卡片和间距，细线分割，能拖动调大小）。
 * 窄屏上下排、整块滚，栏之间横线；lg 以上左右排，各栏自己滚，竖线就是拖动条
 */
export const SPLIT_ROW =
  'ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:divide-y ue:divide-line ue:overflow-auto ue:lg:flex-row ue:lg:divide-y-0 ue:lg:overflow-hidden'
/** 上下堆叠的几块（设置、概览、监视）：贴边排，块之间一道横线，整页滚 */
export const STACK = 'ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:divide-y ue:divide-line ue:overflow-auto'
/** 定宽的那一栏（宽度、上限来自 usePane().style） */
export const PANE_FIXED = 'ue:shrink-0 ue:lg:w-(--ue-w) ue:lg:max-w-(--ue-max)'
/** 占满剩下宽度的那一栏 */
export const PANE_FILL = 'ue:min-w-0 ue:lg:flex-1'
/** 上下分栏里定高的那一块（高度、上限来自 usePaneHeight().style）；窄屏整块滚时给个最小高度 */
export const PANE_FIXED_H = 'ue:shrink-0 ue:min-h-48 ue:lg:min-h-0 ue:lg:h-(--ue-h) ue:lg:max-h-(--ue-hmax)'
/** 上下分栏里占满剩下高度的那一块 */
export const PANE_FILL_H = 'ue:min-h-0 ue:lg:flex-1'

/**
 * 两栏中间的拖动条。
 * - 默认放在两栏之间，就是那道 1px 的分隔线（左右各多 3px 好按住，用负边距不占位置），悬停、拖动时变强调色；只在 lg 以上分栏时出现。
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
  // 竖向（上下分栏）：side=left 表示被拖的块在拖动条上面，往下拖变高；right 表示在下面，往上拖变高
  const y = pane.axis === 'y'
  const dir = side === 'left' ? 1 : -1
  const at = (e: { clientX: number; clientY: number }) => (y ? e.clientY : e.clientX)
  const sizeOf = () => {
    const r = paneRef.current?.getBoundingClientRect()
    return (y ? r?.height : r?.width) ?? 0
  }
  const limits = () => {
    const box = paneRef.current?.parentElement
    if (!box) return Infinity
    const cs = getComputedStyle(box)
    return y
      ? box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - reserve()
      : box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - reserve()
  }
  const clamp = (n: number, max: number) => Math.max(pane.min, Math.min(Math.max(pane.min, max), n))
  const nudge = (d: number) => pane.set(clamp(sizeOf() + d, limits()))
  const [less, more] = y ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
  const cursor = y ? 'ue:cursor-row-resize' : 'ue:cursor-col-resize'
  return (
    <div
      role="separator"
      aria-orientation={y ? 'horizontal' : 'vertical'}
      aria-label={y ? t('拖动调整高度') : t('拖动调整宽度')}
      tabIndex={0}
      title={y ? t('拖动调整高度，双击恢复默认') : t('拖动调整宽度，双击恢复默认')}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: at(e), w: sizeOf(), max: limits() }
        pane.setDragging(true)
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (s) pane.set(clamp(s.w + dir * (at(e) - s.x), s.max))
      }}
      onPointerUp={(e) => {
        const s = start.current
        if (!s) return
        start.current = null
        pane.setDragging(false)
        const n = clamp(s.w + dir * (at(e) - s.x), s.max)
        pane.set(n)
        pane.save(n)
      }}
      onDoubleClick={pane.reset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10
        if (e.key === less) nudge(-dir * step)
        else if (e.key === more) nudge(dir * step)
        else return
        e.preventDefault()
      }}
      onKeyUp={(e) => {
        if (e.key === less || e.key === more) pane.save(sizeOf() || undefined)
      }}
      className={cn(
        'ue:group ue:outline-none',
        cursor,
        edge
          ? 'ue:absolute ue:inset-y-0 ue:-right-[3px] ue:z-20 ue:hidden ue:w-[6px] ue:md:block'
          : y
            ? 'ue:relative ue:z-10 ue:-my-[3px] ue:hidden ue:h-[7px] ue:shrink-0 ue:self-stretch ue:lg:block'
            : 'ue:relative ue:z-10 ue:-mx-[3px] ue:hidden ue:w-[7px] ue:shrink-0 ue:self-stretch ue:lg:block',
      )}
    >
      <span
        className={cn(
          'ue:absolute ue:transition-colors',
          y ? 'ue:inset-x-0 ue:top-[3px] ue:h-px' : 'ue:inset-y-0',
          !y && (edge ? 'ue:right-[2px] ue:w-[2px]' : 'ue:left-[3px] ue:w-px'),
          pane.dragging
            ? 'ue:bg-accent'
            : cn(!edge && 'ue:bg-line', 'ue:group-hover:bg-accent/60 ue:group-focus-visible:bg-accent/60'),
        )}
      />
      {/* 拖动时盖一层透明遮罩：鼠标经过属性表、截图时不丢事件，光标也一直是拖动箭头 */}
      {pane.dragging && <span className={cn('ue:fixed ue:inset-0 ue:z-50', cursor)} />}
    </div>
  )
}
