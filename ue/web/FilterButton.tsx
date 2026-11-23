import { ListFilter } from 'lucide-react'
import { h } from './host.ts'
import { openMenuAt } from '@panel/web/src/components/ui/item-menu'

export interface FilterOpt<T extends string> {
  id: T
  label: string
  /** 右边的个数（菜单里显示，选中时也带在图标后面） */
  count?: number | string
}

/**
 * 收在搜索框里的筛选图标（用户 2026-11-19：资源页的类型筛选、AssetForge 的同步状态都这样收，
 * 给输入框腾宽度，也不再占一整行页签）：没筛时只是一个灰图标，选了非默认项时变强调色并带上名字和个数，
 * 点开是普通下拉菜单，当前项打勾。第一项是「全部」这类默认项
 */
export function FilterButton<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  /** 按钮的说明（悬停提示、读屏） */
  label: string
  value: T
  options: FilterOpt<T>[]
  onChange: (v: T) => void
}) {
  const { cn } = h()
  const cur = options.find((o) => o.id === value)
  const on = !!cur && cur.id !== options[0]?.id
  const text = (o: FilterOpt<T>) => (o.count === undefined ? o.label : `${o.label} ${o.count}`)
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-label={label}
      title={on && cur ? `${label}：${text(cur)}` : label}
      onClick={(e) =>
        openMenuAt(
          e.currentTarget,
          options.map((o) => ({
            label: o.label,
            hint: o.count === undefined ? undefined : String(o.count),
            checked: o.id === value,
            onClick: () => onChange(o.id),
          })),
        )
      }
      className={cn(
        'ue:flex ue:h-6 ue:min-w-0 ue:shrink ue:cursor-pointer ue:items-center ue:gap-1 ue:rounded-md ue:px-1.5 ue:hover:bg-hover',
        on ? 'ue:bg-accent-soft ue:text-accent-text' : 'ue:text-subtle ue:hover:text-fg',
      )}
    >
      <ListFilter className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
      {on && cur && <span className="ue:max-w-24 ue:truncate ue:text-caption">{text(cur)}</span>}
    </button>
  )
}
