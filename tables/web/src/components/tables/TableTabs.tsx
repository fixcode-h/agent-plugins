import { useState } from 'react'
import { ChevronDown, FileSpreadsheet, Lock, X } from 'lucide-react'
import { t } from '@shared/i18n'
import { copyText } from '@/lib/copy-text'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from '@/components/ui/menu'
import { IconButton } from '@/components/ui/icon-button'
import { middleEllipsis } from './table-tree'

/** 页签多过这么多个时，右边出「全部页签」下拉 */
const MANY = 5

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/**
 * 表格页顶上打开的文件页签：像编辑器一样能同时开几个表来回切。
 * 有没保存改动的页签名字后面一个点，悬停时点换成关闭按钮；只读的带锁。
 * 中键关闭，右键「关闭其它 / 关闭右侧 / 复制路径 / 在文件树中定位」，拖动排序；多了右边有「全部页签」下拉
 */
export function TableTabs({
  paths,
  active,
  dirty,
  readOnly,
  onPick,
  onClose,
  onCloseMany,
  onReorder,
  onLocate,
  children,
}: {
  paths: string[]
  active: string
  dirty?: Set<string>
  readOnly?: Set<string>
  onPick: (p: string) => void
  onClose: (p: string) => void
  /** 一次关几个（有没保存改动的留着，由外面决定） */
  onCloseMany?: (ps: string[]) => void
  onReorder?: (paths: string[]) => void
  /** 在左边文件树里定位 */
  onLocate?: (p: string) => void
  /** 页签右边的操作（保存、对比……） */
  children?: React.ReactNode
}) {
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const drop = (target: string) => {
    if (!drag || drag === target || !onReorder) return
    const rest = paths.filter((p) => p !== drag)
    rest.splice(rest.indexOf(target) + (paths.indexOf(drag) < paths.indexOf(target) ? 1 : 0), 0, drag)
    onReorder(rest)
  }
  return (
    <div className="tb:flex tb:h-10 tb:shrink-0 tb:items-stretch tb:border-b tb:bg-panel">
      <div
        role="tablist"
        aria-label={t('打开的表格')}
        className="tb:flex tb:min-w-0 tb:flex-1 tb:items-stretch tb:overflow-x-auto"
      >
        {paths.map((p, i) => {
          const on = p === active
          const changed = !!dirty?.has(p)
          const locked = !!readOnly?.has(p)
          const name = baseName(p)
          return (
            <ContextMenu key={p}>
              <ContextMenuTrigger asChild>
                <div
                  draggable={!!onReorder}
                  onDragStart={(e) => {
                    setDrag(p)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    if (!drag) return
                    e.preventDefault()
                    setOver(p)
                  }}
                  onDragLeave={() => setOver((o) => (o === p ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault()
                    drop(p)
                    setDrag(null)
                    setOver(null)
                  }}
                  onDragEnd={() => {
                    setDrag(null)
                    setOver(null)
                  }}
                  className={cn(
                    'tb:group/tab tb:relative tb:flex tb:shrink-0 tb:items-center tb:border-r',
                    on ? 'tb:bg-bg tb:text-fg' : 'tb:text-muted tb:hover:bg-hover tb:hover:text-fg',
                    drag === p && 'tb:opacity-50',
                    over === p && drag !== p && 'tb:shadow-[inset_2px_0_0_var(--accent)]',
                  )}
                >
                  {on && <span aria-hidden className="tb:absolute tb:inset-x-0 tb:top-0 tb:h-0.5 tb:bg-accent" />}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={on}
                    title={p}
                    onClick={() => onPick(p)}
                    onAuxClick={(e) => e.button === 1 && onClose(p)}
                    className="tb:flex tb:h-full tb:max-w-[240px] tb:cursor-pointer tb:items-center tb:gap-1.5 tb:pr-1 tb:pl-3 tb:text-body"
                  >
                    <FileSpreadsheet className="tb:h-3.5 tb:w-3.5 tb:shrink-0 tb:text-subtle" />
                    <span className="tb:truncate">{middleEllipsis(name)}</span>
                    {locked && <Lock aria-label={t('只读')} className="tb:h-3 tb:w-3 tb:shrink-0 tb:text-subtle" />}
                  </button>
                  <button
                    type="button"
                    aria-label={t('关闭 {name}', { name })}
                    title={changed ? t('有未保存的改动') : t('关闭')}
                    onClick={() => onClose(p)}
                    className="tb:mr-1.5 tb:grid tb:h-5 tb:w-5 tb:cursor-pointer tb:place-items-center tb:rounded-sm tb:text-subtle tb:hover:bg-active tb:hover:text-fg"
                  >
                    {changed ? (
                      <>
                        <span className="tb:h-2 tb:w-2 tb:rounded-full tb:bg-accent tb:group-hover/tab:hidden" />
                        <X className="tb:hidden tb:h-3 tb:w-3 tb:group-hover/tab:block" />
                      </>
                    ) : (
                      <X className={cn('tb:h-3 tb:w-3', !on && 'tb:opacity-0 tb:group-hover/tab:opacity-100')} />
                    )}
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => onClose(p)}>{t('关闭')}</ContextMenuItem>
                {onCloseMany && paths.length > 1 && (
                  <ContextMenuItem onSelect={() => onCloseMany(paths.filter((x) => x !== p))}>
                    {t('关闭其它')}
                  </ContextMenuItem>
                )}
                {onCloseMany && i < paths.length - 1 && (
                  <ContextMenuItem onSelect={() => onCloseMany(paths.slice(i + 1))}>{t('关闭右侧')}</ContextMenuItem>
                )}
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => void copyText(p, { done: t('已复制路径') })}>
                  {t('复制路径')}
                </ContextMenuItem>
                {onLocate && <ContextMenuItem onSelect={() => onLocate(p)}>{t('在文件树中定位')}</ContextMenuItem>}
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      {paths.length > MANY && (
        <div className="tb:flex tb:shrink-0 tb:items-center tb:border-l tb:px-1">
          <Menu>
            <MenuTrigger asChild>
              <IconButton icon={ChevronDown} label={t('全部页签（{n} 个）', { n: paths.length })} />
            </MenuTrigger>
            <MenuContent align="end">
              {paths.map((p) => (
                <MenuItem key={p} onSelect={() => onPick(p)} className={cn(p === active && 'tb:font-semibold')}>
                  <span className="tb:min-w-0 tb:flex-1 tb:truncate">{baseName(p)}</span>
                  {dirty?.has(p) && <span className="tb:h-1.5 tb:w-1.5 tb:shrink-0 tb:rounded-full tb:bg-accent" />}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </div>
      )}
      {children && <div className="tb:flex tb:shrink-0 tb:items-center tb:gap-1 tb:px-2">{children}</div>}
    </div>
  )
}
