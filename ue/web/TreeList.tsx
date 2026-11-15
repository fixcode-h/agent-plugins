import type { LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Caret } from './details/controls.tsx'
import { h, t } from './host.ts'

/** 摊平后的一行：树按展开状态摊成一列再渲染，只画看得见的那一段（几万个 Actor 也不卡） */
export interface TreeLine {
  key: string
  depth: number
  label: ReactNode
  icon: LucideIcon
  /** 有子项：显示展开箭头 */
  expandable: boolean
  open: boolean
  selected: boolean
  title?: string
  aside?: ReactNode
  onToggle?: () => void
  onSelect?: () => void
}

const ROW = 28

/**
 * 只渲染可见范围的树列表（行高固定 28px，照组件树的样式）：上下各多画 20 行，滚动时换。
 * 世界大纲、UObject 树共用；组件树行数少，还是 CompTree 自己画
 */
export function TreeList({ lines, label }: { lines: TreeLine[]; label: string }) {
  const { cn } = h()
  const [scroll, setScroll] = useState({ top: 0, height: 800 })
  const start = Math.max(0, Math.floor(scroll.top / ROW) - 20)
  const end = Math.min(lines.length, Math.ceil((scroll.top + scroll.height) / ROW) + 20)
  return (
    <div
      role="tree"
      aria-label={label}
      className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:py-1"
      onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
      ref={(el) => {
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') (l.onSelect ?? l.onToggle)?.()
                else if (e.key === 'ArrowLeft' && l.expandable && l.open) l.onToggle?.()
                else if (e.key === 'ArrowRight' && l.expandable && !l.open) l.onToggle?.()
              }}
              style={{ top: (start + i) * ROW, height: ROW, paddingLeft: 6 + l.depth * 16 }}
              className={cn(
                'ue:absolute ue:inset-x-0 ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:pr-2 ue:text-footnote ue:outline-none ue:transition-colors ue:focus-visible:bg-hover',
                l.selected ? 'ue:bg-sel ue:text-fg' : 'ue:text-fg ue:hover:bg-hover',
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
              <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-muted" />
              <span className="ue:min-w-0 ue:truncate">{l.label}</span>
              {l.aside && (
                <span className="ue:ml-auto ue:shrink-0 ue:pl-2 ue:text-caption ue:text-subtle">{l.aside}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
