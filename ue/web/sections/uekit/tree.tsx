import { ChevronRight, Folder, FolderOpen, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { h } from '../../host.ts'

/**
 * AssetForge、GameTest 左栏的文件树：样子和表格插件的文件树一样（用户 2026-11-15「类似表格的 UI」）——
 * 28px 行、每层缩进 14px、文件夹默认折叠、展开了才画里面的行（几千个资产也不卡），选中浅底加粗。
 * 搜索时只留命中的项和它们的上级目录，全部展开。
 */
const INDENT = 14

export interface TreeLeaf<T> {
  /** 用 / 分隔的路径，最后一段是名字 */
  path: string
  data: T
}

interface Node<T> {
  path: string
  name: string
  leaf?: T
  children: Node<T>[]
  leaves: T[]
}

function build<T>(items: TreeLeaf<T>[]): Node<T>[] {
  const root: Node<T> = { path: '', name: '', children: [], leaves: [] }
  const dirs = new Map<string, Node<T>>([['', root]])
  for (const it of items) {
    const parts = it.path.split('/').filter(Boolean)
    let parent = root
    parent.leaves.push(it.data)
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts.slice(0, i + 1).join('/')
      let d = dirs.get(p)
      if (!d) {
        d = { path: p, name: parts[i], children: [], leaves: [] }
        dirs.set(p, d)
        parent.children.push(d)
      }
      d.leaves.push(it.data)
      parent = d
    }
    parent.children.push({ path: it.path, name: parts.at(-1) ?? it.path, leaf: it.data, children: [], leaves: [] })
  }
  // 文件夹在前，各自按名字排
  const sort = (n: Node<T>) => {
    n.children.sort((a, b) => Number(!!a.leaf) - Number(!!b.leaf) || a.name.localeCompare(b.name))
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}

export function FileTree<T>({
  items,
  active,
  searching,
  onOpen,
  leafIcon,
  leafRight,
  leafDim,
  folderRight,
  onLeafMenu,
  onFolderMenu,
  label,
  empty,
}: {
  items: TreeLeaf<T>[]
  active?: string
  /** 正在搜索：全部展开 */
  searching?: boolean
  onOpen: (path: string, data: T) => void
  leafIcon: (d: T) => { icon: LucideIcon; tone: string }
  leafRight?: (d: T) => ReactNode
  /** 变灰的行（没有配置的资产） */
  leafDim?: (d: T) => boolean
  folderRight?: (leaves: T[]) => ReactNode
  /** 右键一行（GameTest 场景的运行、改名、删除……）：文件夹给 path 和下面的全部叶子 */
  onLeafMenu?: (e: MouseEvent, path: string, data: T) => void
  onFolderMenu?: (e: MouseEvent, path: string, leaves: T[]) => void
  label: string
  empty: ReactNode
}) {
  const { cn } = h()
  const tree = useMemo(() => build(items), [items])
  const [opened, setOpened] = useState<Set<string>>(() => new Set())
  // 只有一个顶层目录时展开它；选中项的上级目录跟着展开（从别处跳过来时看得到它在哪）
  const single = tree.length === 1 && !tree[0].leaf ? tree[0].path : ''
  useEffect(() => {
    if (single) setOpened((s) => (s.has(single) ? s : new Set(s).add(single)))
  }, [single])
  useEffect(() => {
    if (!active) return
    const parts = active.split('/')
    setOpened((s) => {
      const next = new Set(s)
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'))
      return next.size === s.size ? s : next
    })
  }, [active])
  if (!items.length) return <>{empty}</>

  const rows: ReactNode[] = []
  const walk = (nodes: Node<T>[], depth: number) => {
    for (const n of nodes) {
      const open = !!searching || opened.has(n.path)
      const leaf = n.leaf
      const meta = leaf !== undefined ? leafIcon(leaf) : undefined
      const Icon = meta?.icon ?? (open ? FolderOpen : Folder)
      rows.push(
        <button
          key={n.path}
          type="button"
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={leaf !== undefined ? undefined : open}
          aria-selected={n.path === active}
          title={n.path}
          onClick={() =>
            leaf !== undefined
              ? onOpen(n.path, leaf)
              : setOpened((s) => {
                  const next = new Set(s)
                  if (!next.delete(n.path)) next.add(n.path)
                  return next
                })
          }
          onContextMenu={(e) =>
            leaf !== undefined ? onLeafMenu?.(e, n.path, leaf) : onFolderMenu?.(e, n.path, n.leaves)
          }
          style={{ paddingLeft: `${6 + depth * INDENT}px` }}
          className={cn(
            'ue:flex ue:h-7 ue:w-full ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-(--c-row-radius) ue:pr-2 ue:text-left ue:text-body ue:transition-colors ue:hover:bg-sel/60',
            leaf !== undefined
              ? 'ue:text-fg ue:aria-selected:bg-sel ue:aria-selected:font-semibold'
              : 'ue:font-medium ue:text-muted',
            leaf !== undefined && leafDim?.(leaf) && 'ue:text-subtle',
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle ue:transition-transform',
              leaf !== undefined && 'ue:invisible',
              open && 'ue:rotate-90',
            )}
          />
          <Icon
            className={cn(
              'ue:h-3.5 ue:w-3.5 ue:shrink-0',
              meta ? meta.tone : 'ue:text-subtle',
              leaf !== undefined && leafDim?.(leaf) && 'ue:opacity-50',
            )}
          />
          <span className="ue:min-w-0 ue:flex-1 ue:truncate">{n.name}</span>
          <span className="ue:flex ue:shrink-0 ue:items-center ue:gap-1.5 ue:text-caption ue:font-normal ue:text-subtle ue:tabular-nums">
            {leaf !== undefined ? leafRight?.(leaf) : folderRight ? folderRight(n.leaves) : n.leaves.length}
          </span>
        </button>,
      )
      if (leaf === undefined && open) walk(n.children, depth + 1)
    }
  }
  walk(tree, 0)
  return (
    <div role="tree" aria-label={label} className="ue:flex ue:flex-col ue:gap-px">
      {rows}
    </div>
  )
}
