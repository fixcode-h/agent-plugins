import { Box } from 'lucide-react'
import { show } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import type { StateKey } from './pick-model.ts'

/**
 * 抓到的控件此刻的状态（效果图 3「控件状态 · UButton」）：可见、能点、文字、勾上，值跟着游戏实时变；
 * 拼条件时每行是单选，选中就按「等于此刻的值」拼一条判断
 */
export function PickState({
  widgetClass,
  rows,
  selected,
  onSelect,
  found,
  lit,
}: {
  widgetClass?: string
  rows: { id: StateKey; label: string; value: unknown }[]
  selected?: StateKey
  /** 不给时只看不选（只挑控件的时候） */
  onSelect?: (id: StateKey, value: unknown) => void
  found?: boolean
  lit: Set<string>
}) {
  const { cn } = h()
  return (
    <div className="ue:flex ue:flex-col">
      <p className="ue:flex ue:items-center ue:gap-1.5 ue:px-3 ue:py-1.5 ue:text-caption ue:text-subtle">
        <Box className="ue:h-3.5 ue:w-3.5" />
        {widgetClass ? t('控件状态 · {c}', { c: widgetClass }) : t('控件状态')}
        {found === false && <span className="ue:text-warning">{t('此刻不在屏上')}</span>}
      </p>
      {rows.map((r) => {
        const on = selected === r.id
        const bool = typeof r.value === 'boolean'
        return (
          <button
            key={r.id}
            type="button"
            disabled={!onSelect}
            aria-pressed={on}
            onClick={() => onSelect?.(r.id, r.value)}
            className={cn(
              'ue:grid ue:h-8 ue:w-full ue:grid-cols-[16px_minmax(0,1fr)_auto] ue:items-center ue:gap-2 ue:border-b ue:border-line/40 ue:px-3 ue:text-left ue:text-footnote ue:transition-colors ue:duration-700',
              onSelect ? 'ue:cursor-pointer ue:hover:bg-hover' : 'ue:cursor-default',
              on && 'ue:bg-sel',
              lit.has(`state:${r.id}`) && !on && 'ue:bg-warning/14 ue:duration-75',
            )}
          >
            <span
              className={cn(
                'ue:h-3.5 ue:w-3.5 ue:rounded-full ue:border ue:border-line',
                !onSelect && 'ue:invisible',
                on && 'ue:border-accent ue:bg-accent',
              )}
            />
            <span className="ue:truncate ue:text-fg">{r.label}</span>
            <span
              className={cn(
                'ue:max-w-48 ue:truncate ue:text-right ue:font-mono',
                bool ? (r.value ? 'ue:text-success' : 'ue:text-danger') : 'ue:text-fg',
              )}
            >
              {r.value === undefined ? '—' : bool ? (r.value ? t('是') : t('否')) : show(r.value)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
