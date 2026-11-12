import { useEffect, useState } from 'react'
import { Bookmark, X } from 'lucide-react'
import { t } from '@shared/i18n'
import type { ColFilters, SheetSort } from '@/lib/sheet-filter'
import { ChipGroup } from '@/components/ui/chip-group'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menu'

/** 快速筛选：只看不合规、改过的、引用缺失的、空着的必填（几个一起选时是「或」） */
export type QuickFilter = 'bad' | 'dirty' | 'ref' | 'need'

/** 存下来的视图：筛选、排序、快速筛选一起 */
export interface SavedView {
  name: string
  filters: ColFilters
  sort: SheetSort | null
  quick: QuickFilter[]
}

function readViews(key: string): SavedView[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === 'string') : []
  } catch {
    return []
  }
}

/** 这张表存下的视图：按项目 + 文件 + 工作表记在本机（每个人自己的习惯） */
export function useSavedViews(key: string) {
  const k = `table-views:${key}`
  const [views, setViews] = useState(() => readViews(k))
  useEffect(() => setViews(readViews(k)), [k])
  const save = (next: SavedView[]) => {
    setViews(next)
    try {
      localStorage.setItem(k, JSON.stringify(next))
    } catch {
      // 存不了就只在这次打开里有效
    }
  }
  return [views, save] as const
}

/**
 * 表格上方的快速筛选：一排小块，旁边带处数；右边「视图」把常用的筛选排序存下来、一点就套用。
 * 筛选只过滤行号数组，不复制数据
 */
export function TableQuickFilter({
  value,
  onChange,
  counts,
  views,
  onViews,
  current,
  onApply,
}: {
  value: QuickFilter[]
  onChange: (v: QuickFilter[]) => void
  counts: Record<QuickFilter, number>
  views: SavedView[]
  onViews: (v: SavedView[]) => void
  /** 现在的筛选和排序（存视图用） */
  current: Omit<SavedView, 'name'>
  onApply: (v: SavedView) => void
}) {
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  const empty = !Object.keys(current.filters).length && !current.sort && !current.quick.length
  const opts: { id: QuickFilter; label: string }[] = [
    { id: 'bad', label: t('只看不合规') },
    { id: 'dirty', label: t('只看改过的') },
    { id: 'ref', label: t('只看引用缺失') },
    { id: 'need', label: t('只看空着的必填') },
  ]
  const save = () => {
    const n = name.trim()
    if (!n) return
    onViews([...views.filter((v) => v.name !== n), { name: n, ...current }])
    setName('')
    setOpen(false)
  }
  return (
    <div className="tb:flex tb:h-8 tb:shrink-0 tb:items-center tb:gap-2 tb:overflow-x-auto tb:border-b tb:bg-panel tb:px-3">
      <ChipGroup
        multiple
        size="sm"
        label={t('快速筛选')}
        value={value}
        onChange={onChange}
        className="tb:flex-nowrap"
        options={opts.map((o) => ({
          ...o,
          disabled: !counts[o.id] && !value.includes(o.id),
          trailing: counts[o.id] ? <span className="tb:tabular-nums tb:opacity-70">{counts[o.id]}</span> : undefined,
        }))}
      />
      <div className="tb:ml-auto tb:flex tb:shrink-0 tb:items-center tb:gap-1">
        {views.map((v) => (
          <span
            key={v.name}
            className="tb:group/view chip-idle tb:inline-flex tb:h-6 tb:items-center tb:rounded-md tb:text-footnote"
          >
            <button
              type="button"
              onClick={() => onApply(v)}
              title={t('套用视图「{name}」', { name: v.name })}
              className="tb:flex tb:h-full tb:cursor-pointer tb:items-center tb:gap-1 tb:pl-2 tb:text-muted tb:hover:text-fg"
            >
              <Bookmark className="tb:h-3 tb:w-3" />
              {v.name}
            </button>
            <button
              type="button"
              aria-label={t('删除视图「{name}」', { name: v.name })}
              onClick={() => onViews(views.filter((x) => x !== v))}
              className="tb:grid tb:h-full tb:w-5 tb:cursor-pointer tb:place-items-center tb:text-subtle tb:opacity-0 tb:group-hover/view:opacity-100 tb:hover:text-fg"
            >
              <X className="tb:h-3 tb:w-3" />
            </button>
          </span>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="tb:h-6 tb:px-2 tb:text-footnote"
              disabled={empty}
              title={empty ? t('先设好筛选或排序') : t('把现在的筛选和排序存成视图')}
            >
              {t('存为视图')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="tb:flex tb:w-64 tb:flex-col tb:gap-2 tb:p-2">
            <Input
              size="sm"
              autoFocus
              value={name}
              placeholder={t('视图名字，例如「只看商城道具」')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <Button size="sm" disabled={!name.trim()} onClick={save}>
              {t('保存视图')}
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
