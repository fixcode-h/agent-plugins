import { AppWindow, Box, List, Square, Type, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { GtPropGroup, GtTreeNode } from '../../../../../shared/gt-script/index.ts'
import { CompTree, type Comp } from '../../../../CompTree.tsx'
import { h, t } from '../../../../host.ts'
import { openMenu } from '../../../../menu.tsx'
import { TreeList, type TreeLine } from '../../../../TreeList.tsx'
import { classShort } from '../describe.ts'
import { KIND_ICON } from './ClassPicker.tsx'
import type { ClassKind } from './data.ts'

const HOVER_MS = 80

/** 结构里的一个节点：part 是从对象自己往下的子控件 / 组件路径（`Header/TxtHeader`），对象自己是空串 */
export interface StructNode {
  key: string
  part: string
  depth: number
  name: string
  class?: string
  icon: LucideIcon
  user?: boolean
  text?: string
  /** 游戏开着时 gt.tree 的节点 id（读属性、描边用） */
  node?: string
  aside?: string
  kids: boolean
}

/** 此刻游戏里的子树（gt.tree root）→ 结构节点。路径只记 UserWidget 和控件自己的名字（面板、画布不算一段） */
export function fromTree(nodes: GtTreeNode[], root: string): StructNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const kids = new Map<string, GtTreeNode[]>()
  for (const n of nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n])
  const out: StructNode[] = []
  const walk = (n: GtTreeNode, depth: number, prefix: string[]) => {
    const part = n.id === root ? [] : [...prefix, n.name ?? '']
    const k = kids.get(n.id) ?? []
    out.push({
      key: n.id,
      part: part.filter(Boolean).join('/'),
      depth,
      name: n.name || classShort(n.class),
      class: n.class,
      icon: n.user ? AppWindow : n.container ? List : n.text !== undefined ? Type : Square,
      user: n.user,
      text: n.text,
      node: n.id,
      aside: n.container
        ? t('{c} · {n} 项', { c: classShort(n.class), n: n.container.count ?? 0 })
        : classShort(n.class),
      kids: k.length > 0,
    })
    // 嵌套的 UserWidget 里的控件写成 `外层名/里层名`；普通面板只是容器，不进路径
    const next = n.id !== root && n.user ? part : prefix
    for (const c of k) walk(c, depth + 1, next)
  }
  const r = byId.get(root)
  if (r) walk(r, 0, [])
  return out
}

/** 没开游戏：按类读到的部件组（gt.props 的 part 组，嵌套的用 . 连）摊成结构；对象自己一行在最上面 */
export function fromGroups(groups: GtPropGroup[] | undefined, self: { name: string; class: string; icon: LucideIcon }) {
  const out: StructNode[] = [
    { key: '@', part: '', depth: 0, name: self.name, class: self.class, icon: self.icon, kids: false },
  ]
  for (const g of groups ?? []) {
    if (!g.part) continue
    const segs = g.part.split(/[./]/).filter(Boolean)
    out.push({
      key: `part:${g.part}`,
      part: segs.join('/'),
      depth: segs.length,
      name: segs.at(-1) ?? g.part,
      class: g.class,
      icon: g.user ? AppWindow : Square,
      user: g.user,
      aside: g.class ? classShort(g.class) : undefined,
      kids: false,
    })
  }
  out[0].kids = out.length > 1
  return out
}

/**
 * 第 2 栏「结构」：UMG 是 Widget 树、Actor 是组件树、Lua 对象 / 普通 UObject 只有自己一行。悬停时在游戏画面上描边；
 * 点子控件 = 第 3 栏看它的属性，加标识时路径带上 `/子控件`。只有 UserWidget 能定类：右键子界面「选这个类」，
 * 别的控件右键「选它所在界面的类」
 */
export function StructurePane({
  title,
  nodes,
  kind,
  selected,
  onSelect,
  onHover,
  onUseClass,
  empty,
  comps,
  owner,
}: {
  title: string
  nodes: StructNode[]
  /** Actor 的组件：给了就照资源页 / AssetForge 的组件树画（挂接缩进、按类的图标、移动这类在分隔线下面） */
  comps?: Comp[]
  /** 组件树第一行（Actor 自己）显示的名字 */
  owner?: string
  kind?: ClassKind
  selected: string
  onSelect: (n: StructNode) => void
  onHover?: (node: string | undefined) => void
  onUseClass: (cls: string) => void
  empty?: string
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const hoverT = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(hoverT.current), [])
  const ownerOf = (i: number) => {
    // 往上找最近的 UserWidget（就是这个控件所在的界面）
    for (let j = i - 1; j >= 0; j--) if (nodes[j].depth < nodes[i].depth && nodes[j].user) return nodes[j].class
    return nodes[0]?.class
  }
  const lines = useMemo(() => {
    const out: TreeLine[] = []
    let hideBelow = -1
    nodes.forEach((n, i) => {
      if (hideBelow >= 0 && n.depth > hideBelow) return
      hideBelow = -1
      const open = !closed.has(n.key)
      if (!open) hideBelow = n.depth
      const Icon = i === 0 && kind ? KIND_ICON[kind] : n.icon
      out.push({
        key: n.key,
        depth: n.depth,
        icon: Icon,
        iconTone: i === 0 || n.user ? 'ue:text-accent' : undefined,
        label: (
          <span className="ue:font-mono">
            {n.name}
            {n.text && <span className="ue:ml-1.5 ue:font-sans ue:text-subtle">「{n.text}」</span>}
          </span>
        ),
        aside: n.aside,
        title: n.part || n.name,
        expandable: n.kids,
        open,
        selected: n.part === selected,
        onToggle: () =>
          setClosed((s) => {
            const x = new Set(s)
            if (x.has(n.key)) x.delete(n.key)
            else x.add(n.key)
            return x
          }),
        onSelect: () => onSelect(n),
        onHover: () => {
          clearTimeout(hoverT.current)
          if (onHover) hoverT.current = setTimeout(() => onHover(n.node), HOVER_MS)
        },
        onMenu: (e: MouseEvent) => {
          e.preventDefault()
          const cls = n.user ? n.class : ownerOf(i)
          if (!cls) return
          openMenu(e, [
            {
              label: n.user ? t('选这个类') : t('选它所在界面的类'),
              icon: n.user ? AppWindow : Box,
              onClick: () => onUseClass(cls),
            },
          ])
        },
      })
    })
    return out
    // ownerOf 只读 nodes
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, closed, selected, kind, onSelect, onHover, onUseClass])
  return (
    <>
      <span className="ue:truncate ue:px-3 ue:pt-2 ue:pb-1 ue:text-caption ue:font-medium ue:text-muted">{title}</span>
      {!nodes.length && empty && (
        <p className="ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">{empty}</p>
      )}
      {comps ? (
        <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
          <CompTree
            actor={owner ?? nodes[0]?.name ?? ''}
            items={comps}
            // 没选部件 = Actor 自己那行；选了的按组件名对回去（对不上时什么都不亮，不误亮自己）
            selected={selected ? (comps.find((c) => c.name === selected)?.path ?? '\0') : ''}
            onSelect={(path) => {
              const n = path ? nodes.find((x) => x.key === path) : nodes[0]
              if (n) onSelect(n)
            }}
          />
        </div>
      ) : (
        <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col" onMouseLeave={() => onHover?.(undefined)}>
          <TreeList lines={lines} label={t('结构')} />
        </div>
      )}
    </>
  )
}
