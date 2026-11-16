import { ArrowDown, ArrowUp, Copy, Crosshair, Star, StarOff } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { Caret } from '../../details/controls.tsx'
import { h, t } from '../../host.ts'
import { copyText, MenuHost, openMenu } from '../../menu.tsx'

/** 收藏区最多露几行，再多在区里滚：别把下面的文件夹树挤没了 */
const MAX_ROWS = 8
const ROW = 28

/**
 * 资源页文件夹树上面的「收藏」区（照 Content Browser 的 Favorites）：一行一个收藏的文件夹，点一下在树里展开并定位，
 * 拖动换顺序，右键定位、上移下移、复制路径、取消收藏。行高、字号和 TreeList 一样，看着是同一棵树的一段。
 * 只管显示和交互，数据由调用方给（fav-data.ts 的 useFavFolders），设置 →「组件」里的示例也用它
 */
export function FavFolders({
  folders,
  selected,
  open,
  onOpenChange,
  onGo,
  onRemove,
  onMove,
  where,
}: {
  folders: string[]
  /** 树里当前高亮的文件夹 */
  selected?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 点了一个收藏：在树里展开到它 */
  onGo: (path: string) => void
  onRemove: (path: string) => void
  /** 挪到第 to 个（按挪走它之后的列表算） */
  onMove: (path: string, to: number) => void
  /** 收藏存在哪（标题的悬停提示） */
  where?: string
}) {
  const { cn } = h()
  const [drag, setDrag] = useState<{ from: string; over?: number }>()

  const menu = (e: MouseEvent, p: string, i: number) =>
    openMenu(e, [
      { title: p },
      { label: t('在树里定位'), icon: Crosshair, onClick: () => onGo(p) },
      i > 0 && { label: t('上移'), icon: ArrowUp, onClick: () => onMove(p, i - 1) },
      i < folders.length - 1 && { label: t('下移'), icon: ArrowDown, onClick: () => onMove(p, i + 1) },
      { label: t('复制路径'), icon: Copy, onClick: () => copyText(p) },
      'sep',
      { label: t('取消收藏'), icon: StarOff, onClick: () => onRemove(p) },
    ])

  return (
    <div className="ue:border-b ue:border-line ue:py-1">
      <button
        type="button"
        aria-expanded={open}
        title={where ? t('收藏存在 {p}', { p: where }) : undefined}
        onClick={() => onOpenChange(!open)}
        className="ue:flex ue:h-7 ue:w-full ue:cursor-pointer ue:items-center ue:gap-1.5 ue:px-1.5 ue:text-footnote ue:text-muted ue:hover:bg-hover ue:hover:text-fg"
      >
        <span className="ue:flex ue:h-4 ue:w-4 ue:shrink-0 ue:items-center ue:justify-center">
          <Caret open={open} />
        </span>
        <Star className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-warning" />
        <span className="ue:font-medium">{t('收藏')}</span>
        <span className="ue:ml-auto ue:pr-1 ue:text-caption ue:text-subtle">{folders.length || ''}</span>
      </button>
      {open && !folders.length && (
        <p className="ue:py-1 ue:pr-3 ue:pl-[30px] ue:text-caption ue:text-subtle">
          {t('悬停文件夹点行尾的星标，或右键「收藏」')}
        </p>
      )}
      {open && !!folders.length && (
        <div role="list" className="ue:overflow-y-auto" style={{ maxHeight: MAX_ROWS * ROW }}>
          {folders.map((p, i) => {
            const cut = p.lastIndexOf('/')
            const name = p.slice(cut + 1) || p
            const parent = cut > 0 ? p.slice(0, cut) : ''
            return (
              <div
                key={p}
                role="listitem"
                tabIndex={0}
                draggable
                title={p}
                onClick={() => onGo(p)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onGo(p)
                  else if (e.key === 'Delete') onRemove(p)
                }}
                onContextMenu={(e) => menu(e, p, i)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  setDrag({ from: p })
                }}
                onDragOver={(e) => {
                  if (!drag) return
                  e.preventDefault()
                  if (drag.over !== i) setDrag({ ...drag, over: i })
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  // 提示线画在目标行上沿，意思是「放到它前面」：从上往下拖时挪走自己后目标往前错了一位
                  if (drag && drag.from !== p) onMove(drag.from, folders.indexOf(drag.from) < i ? i - 1 : i)
                  setDrag(undefined)
                }}
                onDragEnd={() => setDrag(undefined)}
                style={{ height: ROW }}
                className={cn(
                  'ue:group ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:pr-2 ue:pl-[26px] ue:text-footnote ue:outline-none ue:transition-colors ue:focus-visible:bg-hover',
                  selected === p ? 'ue:bg-sel ue:text-fg' : 'ue:text-fg ue:hover:bg-hover',
                  drag?.from === p && 'ue:opacity-50',
                  drag && drag.over === i && drag.from !== p && 'ue:shadow-[inset_0_2px_0_var(--accent)]',
                )}
              >
                <Star className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:fill-current ue:text-warning" />
                <span className="ue:min-w-0 ue:shrink-0 ue:truncate">{name}</span>
                <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
                  {parent}
                </span>
                <button
                  type="button"
                  aria-label={t('取消收藏')}
                  title={t('取消收藏')}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(p)
                  }}
                  className="ue:flex ue:h-5 ue:w-5 ue:shrink-0 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded ue:text-subtle ue:opacity-0 ue:group-hover:opacity-100 ue:group-focus-visible:opacity-100 ue:hover:text-fg"
                >
                  <StarOff className="ue:h-3 ue:w-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 文件夹行尾的星标：收藏了是实心黄星（一直显示），没收藏是空心（悬停才露出来，TreeLine.action） */
export function FavStar({ on, onClick }: { on: boolean; onClick: () => void }) {
  const { cn } = h()
  return (
    <button
      type="button"
      aria-label={on ? t('取消收藏') : t('收藏')}
      title={on ? t('取消收藏') : t('收藏')}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'ue:flex ue:h-5 ue:w-5 ue:cursor-pointer ue:items-center ue:justify-center ue:rounded ue:hover:bg-hover',
        on ? 'ue:text-warning' : 'ue:text-subtle ue:hover:text-fg',
      )}
    >
      <Star className={cn('ue:h-3 ue:w-3', on && 'ue:fill-current')} />
    </button>
  )
}

/** 设置 →「组件」里的示例：一份收藏区，点、拖、右键都是真的（只改这份示例自己的列表） */
export function FavFoldersSpecimen() {
  const [list, setList] = useState(['/Game/Effects', '/Game/UI/Common', '/Game/Maps', '/UELink/Test'])
  const [open, setOpen] = useState(true)
  const [sel, setSel] = useState('/Game/Effects')
  const move = (p: string, to: number) => {
    const rest = list.filter((x) => x !== p)
    setList([...rest.slice(0, to), p, ...rest.slice(to)])
  }
  return (
    <div className="ue:w-full ue:max-w-sm ue:overflow-hidden ue:rounded-lg ue:border ue:border-line ue:bg-card">
      <FavFolders
        folders={list}
        selected={sel}
        open={open}
        onOpenChange={setOpen}
        onGo={setSel}
        onRemove={(p) => setList(list.filter((x) => x !== p))}
        onMove={move}
        where="docs/AgentPanel/UE/favorites.json"
      />
      <div className="ue:flex ue:h-7 ue:items-center ue:gap-1 ue:pl-1.5 ue:text-footnote ue:text-fg">
        <span className="ue:w-4" />
        <span className="ue:min-w-0 ue:flex-1 ue:truncate">Content</span>
        <FavStar on={false} onClick={() => undefined} />
        <FavStar on onClick={() => undefined} />
      </div>
      <MenuHost />
    </div>
  )
}
