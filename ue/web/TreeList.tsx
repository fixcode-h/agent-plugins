import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Caret } from './details/controls.tsx'
import { h, t } from './host.ts'

/** 摊平后的一行：树按展开状态摊成一列再渲染，只画看得见的那一段（几万个 Actor 也不卡） */
export interface TreeLine {
  key: string
  depth: number
  label: ReactNode
  icon: LucideIcon
  /** 图标颜色的类名（资源按类型上色）；不给是灰色 */
  iconTone?: string
  /** 有子项：显示展开箭头 */
  expandable: boolean
  open: boolean
  selected: boolean
  /** 检视区正在看的东西是从这一行点引用过去的（设计稿第 4 节「from」状态）：左边一道强调色细条 */
  from?: boolean
  title?: string
  aside?: ReactNode
  onToggle?: () => void
  onSelect?: () => void
  /** 右键这一行（资源文件夹树的收藏、资源的「在 UE 编辑器打开」） */
  onMenu?: (e: MouseEvent) => void
  /** 行尾的小按钮（文件夹的收藏星标）：平时隐藏，悬停或键盘选中这一行才露出来；actionShown 时一直显示（已收藏） */
  action?: ReactNode
  actionShown?: boolean
}

const ROW = 28

/**
 * 只渲染可见范围的树列表（行高固定 28px，照组件树的样式）：上下各多画 20 行，滚动时换。
 * 世界大纲、UObject 树、资源文件夹树共用；组件树行数少，还是 CompTree 自己画。
 * reveal：滚到 key 这一行（seq 变了才滚一次）。行是按需画的，没法对 DOM 调 scrollIntoView，按行号算位置
 */
export function TreeList({
  lines,
  label,
  reveal,
}: {
  lines: TreeLine[]
  label: string
  reveal?: { key: string; seq: number }
}) {
  const { cn } = h()
  const [scroll, setScroll] = useState({ top: 0, height: 800 })
  const box = useRef<HTMLDivElement>(null)
  const done = useRef(0)
  useEffect(() => {
    const el = box.current
    if (!reveal || !el || done.current === reveal.seq) return
    // 逐层读的时候行还没出来：等 lines 变了再找
    const i = lines.findIndex((l) => l.key === reveal.key)
    if (i < 0) return
    done.current = reveal.seq
    const top = i * ROW
    if (top < el.scrollTop || top + ROW > el.scrollTop + el.clientHeight)
      el.scrollTop = Math.max(0, top - el.clientHeight / 2 + ROW / 2)
  }, [reveal, lines])
  const start = Math.max(0, Math.floor(scroll.top / ROW) - 20)
  const end = Math.min(lines.length, Math.ceil((scroll.top + scroll.height) / ROW) + 20)
  return (
    <div
      role="tree"
      aria-label={label}
      className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1"
      onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
      ref={(el) => {
        box.current = el
        if (el && Math.abs(el.clientHeight - scroll.height) > 40)
          setScroll({ top: el.scrollTop, height: el.clientHeight })
      }}
    >
      <div style={{ height: lines.length * ROW, position: 'relative' }}>
        {lines.slice(start, end).map((l, i) => {
          const Icon = l.icon
          return (
            <div
              key={l.key}
              role="treeitem"
              aria-selected={l.selected}
              aria-expanded={l.expandable ? l.open : undefined}
              tabIndex={0}
              title={l.title}
              onClick={() => (l.onSelect ?? l.onToggle)?.()}
              onContextMenu={l.onMenu}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (l.onSelect ?? l.onToggle)?.()
                else if (e.key === 'ArrowLeft' && l.expandable && l.open) l.onToggle?.()
                else if (e.key === 'ArrowRight' && l.expandable && !l.open) l.onToggle?.()
              }}
              style={{ top: (start + i) * ROW, height: ROW, paddingLeft: 6 + l.depth * 16 }}
              className={cn(
                'ue:group ue:absolute ue:inset-x-0 ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:pr-2 ue:text-footnote ue:outline-none ue:transition-colors ue:focus-visible:bg-hover',
                l.selected ? 'ue:bg-sel ue:text-fg' : 'ue:text-fg ue:hover:bg-hover',
                l.from && 'ue:bg-hover ue:shadow-[inset_2px_0_0_var(--accent)]',
              )}
            >
              {l.expandable ? (
                <button
                  type="button"
                  aria-label={l.open ? t('收起') : t('展开')}
                  onClick={(e) => {
                    e.stopPropagation()
                    l.onToggle?.()
                  }}
                  className="ue:flex ue:h-4 ue:w-4 ue:shrink-0 ue:cursor-pointer ue:items-center ue:justify-center ue:text-muted ue:hover:text-fg"
                >
                  <Caret open={l.open} />
                </button>
              ) : (
                <span className="ue:w-4 ue:shrink-0" />
              )}
              <Icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', l.iconTone ?? 'ue:text-muted')} />
              <span className="ue:min-w-0 ue:truncate">{l.label}</span>
              {l.aside && (
                <span className="ue:ml-auto ue:shrink-0 ue:pl-2 ue:text-caption ue:text-subtle">{l.aside}</span>
              )}
              {l.action && (
                <span
                  className={cn(
                    'ue:flex ue:shrink-0 ue:items-center',
                    !l.aside && 'ue:ml-auto',
                    !l.actionShown && 'ue:opacity-0 ue:group-hover:opacity-100 ue:group-focus-visible:opacity-100',
                  )}
                >
                  {l.action}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
