import { ArrowDown, ArrowUp, Star, StarOff, type LucideIcon } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { Caret } from '../../../details/controls.tsx'
import { h, t } from '../../../host.ts'
import { openMenu, type MenuItem } from '../../../menu.tsx'
import { SplitHandle, usePaneHeight } from '../../../split.tsx'

export interface FavRow {
  key: string
  icon: LucideIcon
  label: ReactNode
  title?: string
  selected?: boolean
  /** 收藏的东西已经不在了（GM 改名、宏删了）：淡显，只能取消收藏 */
  gone?: boolean
  onClick: () => void
  /** 右键菜单前面这条自己的动作（执行、打开、填回参数……）；不在了的条目不给 */
  menu?: () => (MenuItem | false | undefined | null | '')[]
}

/**
 * 左栏最下面的收藏（规格第 6 节）：每个分类一份，可以折起来；展开时上沿能拖、高度记在本机（每个分类共用一个高度）。
 * 右键：这条自己的动作（GmNav 给：执行 / 打开 / 填回参数……），再是取消收藏、上移、下移
 */
export function FavPane({
  rows,
  open,
  onOpenChange,
  onRemove,
  onMove,
  empty,
}: {
  rows: FavRow[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemove: (i: number) => void
  onMove: (i: number, to: number) => void
  empty: string
}) {
  const { cn } = h()
  const pane = usePaneHeight('gm-favs', '10rem', 72)
  const ref = useRef<HTMLDivElement>(null)
  return (
    <>
      {open && <SplitHandle pane={pane} paneRef={ref} side="right" reserve={() => 160} />}
      {/* 拖的是整块（标题 + 列表）：SplitHandle 按它的父元素（左栏）算上限 */}
      <div
        ref={ref}
        style={open ? { height: pane.size } : undefined}
        className="ue:flex ue:max-h-[60%] ue:shrink-0 ue:flex-col ue:border-t ue:border-line"
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="ue:flex ue:h-8 ue:w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:px-1.5 ue:text-footnote ue:text-muted ue:hover:bg-hover ue:hover:text-fg"
        >
          <span className="ue:flex ue:h-4 ue:w-4 ue:shrink-0 ue:items-center ue:justify-center">
            <Caret open={open} />
          </span>
          <Star className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-warning" />
          <span className="ue:font-medium">{t('收藏')}</span>
          <span className="ue:ml-auto ue:pr-1 ue:text-caption ue:text-subtle">{rows.length || ''}</span>
        </button>
        {open && (
          <div role="list" className="ue:min-h-0 ue:flex-1 ue:overflow-y-auto ue:pb-1">
            {!rows.length && <p className="ue:py-1 ue:pr-3 ue:pl-[30px] ue:text-caption ue:text-subtle">{empty}</p>}
            {rows.map((r, i) => {
              const Icon = r.icon
              return (
                <div
                  key={`${r.key}|${i}`}
                  role="listitem"
                  tabIndex={0}
                  title={r.title}
                  onClick={r.gone ? undefined : r.onClick}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !r.gone) r.onClick()
                    else if (e.key === 'Delete') onRemove(i)
                  }}
                  onContextMenu={(e) =>
                    openMenu(e, [
                      ...(!r.gone && r.menu ? r.menu() : []),
                      'sep',
                      { label: t('取消收藏'), icon: StarOff, onClick: () => onRemove(i) },
                      'sep',
                      { label: t('上移'), icon: ArrowUp, disabled: !i, onClick: () => onMove(i, i - 1) },
                      {
                        label: t('下移'),
                        icon: ArrowDown,
                        disabled: i === rows.length - 1,
                        onClick: () => onMove(i, i + 1),
                      },
                    ])
                  }
                  className={cn(
                    'ue:flex ue:h-7 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:pr-2 ue:pl-[26px] ue:text-footnote ue:outline-none ue:focus-visible:bg-hover',
                    r.selected ? 'ue:bg-sel ue:text-fg' : 'ue:text-fg ue:hover:bg-hover',
                    r.gone && 'ue:opacity-45',
                  )}
                >
                  <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-muted" />
                  <span className="ue:min-w-0 ue:truncate">{r.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
