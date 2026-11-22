import type { LucideIcon } from 'lucide-react'
import { h } from '../../../host.ts'

export interface CatRow<K extends string> {
  id: K
  icon: LucideIcon
  label: string
  /** 条数；写「—」这类文字时 why 说明为什么列不出来 */
  count: string | number
  why?: string
}

/**
 * 竖排的分类行（GM 页左栏顶上：常用 · GM · 引擎命令 · 宏 · 对象调用，用户 2026-11-22 取代分段按钮）：
 * 图标 + 名字 + 条数，和 UE 页二级面板里其他列表的行一个样子。列不出来的条数（UE 没开时的 C++ GM）淡显、悬停写原因
 */
export function CatRows<K extends string>({
  rows,
  value,
  onChange,
  label,
}: {
  rows: CatRow<K>[]
  value: K
  onChange: (id: K) => void
  label: string
}) {
  const { cn } = h()
  return (
    <div role="tablist" aria-label={label} className="ue:flex ue:flex-col ue:gap-px">
      {rows.map((r) => {
        const on = r.id === value
        return (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(r.id)}
            className={cn(
              'ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:px-2 ue:text-left ue:text-body',
              on ? 'ue:bg-sel ue:font-medium ue:text-fg' : 'ue:text-muted ue:hover:bg-hover ue:hover:text-fg',
            )}
          >
            <r.icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
            <span className="ue:min-w-0 ue:flex-1 ue:truncate">{r.label}</span>
            <span
              title={r.why}
              className={cn('ue:text-caption ue:tabular-nums ue:text-subtle', r.why && 'ue:opacity-70')}
            >
              {r.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
