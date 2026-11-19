import { Hash, ListTree } from 'lucide-react'
import { h, t } from '../../../host.ts'
import { Card } from '../../../ui.tsx'

/** 分类索引（效果图 B8 左栏）：「全部」+ 各分类和属性数，点一下中间只看这个分类 */
export function CategoryIndex({
  cats,
  value,
  onChange,
}: {
  cats: { name: string; count: number }[]
  value: string
  onChange: (c: string) => void
}) {
  const { cn } = h()
  const item = (key: string, label: string, count?: number) => (
    <button
      key={key || '__all'}
      type="button"
      aria-pressed={value === key}
      onClick={() => onChange(key)}
      className={cn(
        'ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-2 ue:px-3 ue:text-left ue:text-footnote ue:transition-colors',
        value === key ? 'ue:bg-sel ue:text-fg' : 'ue:text-fg ue:hover:bg-hover',
      )}
    >
      <Hash className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
      <span className="ue:min-w-0 ue:flex-1 ue:truncate">{label}</span>
      {count !== undefined && <span className="ue:font-mono ue:text-caption ue:text-subtle">{count}</span>}
    </button>
  )
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={
        <>
          <ListTree className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
          {t('分类')}
        </>
      }
      bodyClass="ue:overflow-auto ue:py-1"
    >
      {item('', t('全部'))}
      {cats.map((c) => item(c.name, c.name, c.count))}
    </Card>
  )
}
