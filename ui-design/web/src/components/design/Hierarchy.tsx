import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Eye, EyeOff, Lock, Plus, Puzzle, Square } from 'lucide-react'
import {
  WIDGETS,
  isWebType,
  typesFor,
  canAddChild,
  entryCount,
  isHiddenVisibility,
  isPanel,
  pathTo,
  type Widget,
  type WidgetGroup,
  type WidgetType,
} from '@shared/umg'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/icon-button'
import { InlineRename } from '@/components/ui/inline-rename'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/menu'
import { t } from '@shared/i18n'
import { WIDGET_ICON, WidgetMenuItems, type WidgetMenuActions } from './WidgetMenu'

const GROUPS: { id: WidgetGroup; label: string }[] = [
  { id: 'panel', label: t('面板') },
  { id: 'list', label: t('列表（运行时生成）') },
  { id: 'common', label: t('常用') },
  { id: 'input', label: t('输入') },
]
const WEB_GROUPS: { id: WidgetGroup; label: string }[] = [{ id: 'web', label: t('网页控件') }]
/** 网页 UI 的设计根控件是 Frame：按根控件判断这棵树用哪套控件 */
const kindOf = (root: Widget) => (isWebType(root.Type) ? 'web' : 'game')
const groupsFor = (kind: 'game' | 'web') => (kind === 'web' ? WEB_GROUPS : GROUPS)

/** 控件面板：点一个控件加到选中的容器里（选中的不是容器就加到它旁边） */
export function Palette({
  components,
  onAdd,
  kind = 'game',
}: {
  kind?: 'game' | 'web'
  components: string[]
  onAdd: (type: WidgetType, cls?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const add = (type: WidgetType, cls?: string) => {
    onAdd(type, cls)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton icon={Plus} label={t('添加控件')} />
      </PopoverTrigger>
      <PopoverContent align="end" className="ud:w-[260px] ud:p-1.5">
        {groupsFor(kind).map((g) => (
          <div key={g.id} className="ud:mb-1">
            <p className="ud:px-2 ud:pt-1.5 ud:pb-1 ud:text-caption ud:text-subtle">{g.label}</p>
            <div className="ud:grid ud:grid-cols-2 ud:gap-px">
              {typesFor(kind)
                .filter((x) => WIDGETS[x].group === g.id)
                .map((x) => {
                  const Icon = WIDGET_ICON[x]
                  return (
                    <button
                      key={x}
                      onClick={() => add(x)}
                      title={WIDGETS[x].hint}
                      className="ud:flex ud:h-7 ud:cursor-pointer ud:items-center ud:gap-2 ud:rounded-md ud:px-2 ud:text-left ud:text-footnote ud:text-muted ud:hover:bg-sel ud:hover:text-fg"
                    >
                      <Icon className="ud:h-3.5 ud:w-3.5 ud:shrink-0 ud:text-subtle" />
                      <span className="ud:truncate">{x}</span>
                    </button>
                  )
                })}
            </div>
          </div>
        ))}
        {components.length > 0 && (
          <div>
            <p className="ud:px-2 ud:pt-1.5 ud:pb-1 ud:text-caption ud:text-subtle">{t('子控件')}</p>
            {components.map((c) => (
              <button
                key={c}
                onClick={() => add('UserWidget', c)}
                className="ud:flex ud:h-7 ud:w-full ud:cursor-pointer ud:items-center ud:gap-2 ud:rounded-md ud:px-2 ud:text-left ud:text-footnote ud:text-muted ud:hover:bg-sel ud:hover:text-fg"
              >
                <Puzzle className="ud:h-3.5 ud:w-3.5 ud:shrink-0 ud:text-subtle" />
                <span className="ud:truncate">{c}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export interface TreeActions {
  select: (id: string) => void
  rename: (id: string, name: string) => void
  move: (id: string, parentId: string, index: number) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  toggleVisible: (id: string) => void
  extract: (id: string) => void
  copy: (id: string) => void
  cut: (id: string) => void
  /** 粘贴到 id 里面（它放得下时），否则粘到它后面 */
  paste: (id: string) => void
  canPaste: boolean
  addChild: (parentId: string, type: WidgetType, cls?: string) => void
  wrap: (id: string, type: WidgetType) => void
  replace: (id: string, type: WidgetType) => void
  /** 可以引用的子控件（UserWidget） */
  components: string[]
}

/** 控件树（Hierarchy）：缩进显示父子关系，拖动调整顺序或换父控件，右键复制、删除、提取成子控件 */
export function Hierarchy({
  root,
  selected,
  actions,
  extra = [],
  onPick,
  renameRequest,
}: {
  root: Widget
  selected: string
  actions: WidgetMenuActions
  /** 按住 Shift / Ctrl 多选的其他控件 */
  extra?: string[]
  /** 按住 Shift / Ctrl 点：加进多选或去掉 */
  onPick?: (id: string) => void
  /** 在画布右键「重命名」：让树里这一行进入改名状态 */
  renameRequest?: { id: string; at: number }
}) {
  const kind = kindOf(root)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState('')
  useEffect(() => {
    if (renameRequest) setRenaming(renameRequest.id)
  }, [renameRequest])
  const [drag, setDrag] = useState('')
  const [drop, setDrop] = useState<{ id: string; where: 'before' | 'after' | 'into' } | null>(null)
  // 选中的控件的上级都要展开
  const open = new Set(pathTo(root, selected).map((w) => w.id))
  const box = useRef<HTMLDivElement>(null)
  // 在树里点的不用滚；在画布上点的，把那一行滚到可见区域中间
  const fromTree = useRef('')
  useEffect(() => {
    const hit = fromTree.current === selected
    fromTree.current = ''
    if (hit) return
    const row = box.current?.querySelector<HTMLElement>(`[data-tid="${CSS.escape(selected)}"]`)
    let sc = row?.parentElement
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
    if (!row || !sc) return
    const r = row.getBoundingClientRect()
    const b = sc.getBoundingClientRect()
    if (r.top >= b.top + 24 && r.bottom <= b.bottom - 24) return
    sc.scrollTo({ top: sc.scrollTop + r.top - b.top - (b.height - r.height) / 2, behavior: 'smooth' })
  }, [selected])

  const rows: { w: Widget; depth: number; parent?: Widget; index: number }[] = []
  const walk = (w: Widget, depth: number, parent?: Widget, index = 0) => {
    rows.push({ w, depth, parent, index })
    if (w.Children?.length && (!folded.has(w.id) || open.has(w.id)))
      w.Children.forEach((c, i) => walk(c, depth + 1, w, i))
  }
  walk(root, 0)

  const onDrop = () => {
    if (!drag || !drop) return
    const target = rows.find((r) => r.w.id === drop.id)
    if (!target) return
    if (drop.where === 'into') actions.move(drag, target.w.id, target.w.Children?.length ?? 0)
    else if (target.parent) actions.move(drag, target.parent.id, target.index + (drop.where === 'after' ? 1 : 0))
  }

  return (
    <div
      ref={box}
      role="tree"
      aria-label={t('控件树')}
      className="ud:flex ud:flex-col ud:py-1"
      onPointerDownCapture={(e) =>
        (fromTree.current = (e.target as HTMLElement).closest<HTMLElement>('[data-tid]')?.dataset.tid ?? '')
      }
      onDragEnd={() => (setDrag(''), setDrop(null))}
    >
      {rows.map(({ w, depth, parent }) => {
        const Icon = WIDGET_ICON[w.Type] ?? Square
        const hasKids = !!w.Children?.length
        const isOpen = !folded.has(w.id) || open.has(w.id)
        const hidden = isHiddenVisibility(w.Properties?.Visibility)
        const locked = !!w.Properties?.Locked
        const on = w.id === selected
        const d = drop?.id === w.id ? drop.where : undefined
        return (
          <ContextMenu key={w.id}>
            <ContextMenuTrigger asChild>
              <div
                role="treeitem"
                data-tid={w.id}
                aria-selected={on}
                aria-expanded={hasKids ? isOpen : undefined}
                draggable={!!parent && renaming !== w.id}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', w.id)
                  setDrag(w.id)
                }}
                onDragOver={(e) => {
                  if (!drag || drag === w.id) return
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  const y = (e.clientY - r.top) / r.height
                  const into = isPanel(w.Type) && canAddChild(w)
                  const where = !parent
                    ? 'into'
                    : into
                      ? y < 0.25
                        ? 'before'
                        : y > 0.75
                          ? 'after'
                          : 'into'
                      : y < 0.5
                        ? 'before'
                        : 'after'
                  if (where === 'into' && !into) return setDrop(null)
                  setDrop({ id: w.id, where })
                }}
                onDragLeave={() => setDrop((x) => (x?.id === w.id ? null : x))}
                onDrop={(e) => {
                  e.preventDefault()
                  onDrop()
                  setDrag('')
                  setDrop(null)
                }}
                onClick={(e) =>
                  onPick && (e.shiftKey || e.ctrlKey || e.metaKey) ? onPick(w.id) : actions.select(w.id)
                }
                onDoubleClick={() => setRenaming(w.id)}
                style={{ paddingLeft: 6 + depth * 14 }}
                className={cn(
                  'ud:group ud:relative ud:flex ud:h-7 ud:cursor-pointer ud:items-center ud:gap-1 ud:pr-1.5 ud:text-footnote ud:select-none',
                  on
                    ? 'ud:bg-accent-soft ud:text-fg'
                    : extra.includes(w.id)
                      ? 'ud:bg-accent-soft/50 ud:text-fg'
                      : 'ud:text-muted ud:hover:bg-sel/60 ud:hover:text-fg',
                  d === 'into' && 'ud:ring-1 ud:ring-accent ud:ring-inset',
                  drag === w.id && 'ud:opacity-40',
                )}
              >
                {d === 'before' && (
                  <span className="ud:absolute ud:inset-x-1 ud:top-0 ud:h-0.5 ud:rounded-sm ud:bg-accent" />
                )}
                {d === 'after' && (
                  <span className="ud:absolute ud:inset-x-1 ud:bottom-0 ud:h-0.5 ud:rounded-sm ud:bg-accent" />
                )}
                <button
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    setFolded((f) => {
                      const n = new Set(f)
                      if (!n.delete(w.id)) n.add(w.id)
                      return n
                    })
                  }}
                  className={cn(
                    'ud:grid ud:h-4 ud:w-4 ud:shrink-0 ud:cursor-pointer ud:place-items-center ud:text-subtle',
                    !hasKids && 'ud:invisible',
                  )}
                  aria-label={isOpen ? t('收起') : t('展开')}
                >
                  <ChevronRight className={cn('ud:h-3 ud:w-3 ud:transition-transform', isOpen && 'ud:rotate-90')} />
                </button>
                <Icon className={cn('ud:h-3.5 ud:w-3.5 ud:shrink-0', on ? 'ud:text-accent-text' : 'ud:text-subtle')} />
                {renaming === w.id ? (
                  <InlineRename
                    size="sm"
                    value={w.Name}
                    label={t('控件名')}
                    onCommit={(v) => {
                      setRenaming('')
                      if (v.trim() && v !== w.Name) actions.rename(w.id, v.trim())
                    }}
                    onCancel={() => setRenaming('')}
                    // 控件树的行很矮，改名框跟着压到行高
                    className="ud:h-5 ud:flex-1 ud:rounded-sm ud:px-1 ud:font-mono ud:text-footnote"
                  />
                ) : (
                  <span className={cn('ud:min-w-0 ud:flex-1 ud:truncate', hidden && 'ud:opacity-50')}>
                    {w.Name}
                    {w.Type === 'UserWidget' && w.Class && (
                      <span className="ud:ml-1.5 ud:text-caption ud:text-subtle">{w.Class}</span>
                    )}
                    {WIDGETS[w.Type]?.entries && (
                      <span
                        className="ud:ml-1.5 ud:text-caption ud:text-subtle"
                        title={
                          w.Type === 'UniformGridPanel'
                            ? t('格子在属性里设置，导出到 UE 时展开成子控件')
                            : t('条目在游戏运行时按数据生成，设计器里只是预览')
                        }
                      >
                        {w.Properties?.EntryWidgetClass || t('未选条目')} ×{entryCount(w)}
                      </span>
                    )}
                  </span>
                )}
                {locked && <Lock aria-label={t('已锁定')} className="ud:h-3 ud:w-3 ud:shrink-0 ud:text-subtle" />}
                {parent && (
                  <IconButton
                    icon={hidden ? EyeOff : Eye}
                    size="2xs"
                    tabIndex={-1}
                    label={hidden ? t('显示') : t('隐藏')}
                    // 隐藏了的控件一直露出眼睛，方便再点开
                    reveal={hidden ? undefined : 'hover'}
                    onClick={(e) => {
                      e.stopPropagation()
                      actions.toggleVisible(w.id)
                    }}
                  />
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <WidgetMenuItems w={w} root={root} actions={actions} kind={kind} onRename={() => setRenaming(w.id)} />
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  )
}
