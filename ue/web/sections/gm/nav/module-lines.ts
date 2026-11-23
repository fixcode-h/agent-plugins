import { CircleAlert, Crosshair, FileCode, Folder, FolderOpen, Package, Wand2 } from 'lucide-react'
import { createElement, type MouseEvent, type ReactNode } from 'react'
import { placeOf } from '../../../../shared/gm/modules.ts'
import type { GmStore } from '../../../../shared/gm/schema.ts'
import { t } from '../../../host.ts'
import type { TreeLine } from '@panel/web/src/components/ui/tree/tree-list'
import type { GmEntry } from '../data.ts'
import type { Mods } from './module-ops.ts'

/**
 * GM 分类的模块树（规格第 6 节、效果图 1）：每个模块下先列 Lua / C++ GM（分组剩下的段当子文件夹），
 * 再列「自定义」文件夹（没有时不显示）；没归模块的放最后的「未归模块」（标黄，提示右键移走）。
 * 只算行，不画：GmNav 交给共用的 TreeList（只画看得见的行）
 */
export const UNSORTED = '§unsorted'

interface Node {
  id: string
  name: string
  kids: Node[]
  gms: GmEntry[]
  total: number
}
const node = (id: string, name: string): Node => ({ id, name, kids: [], gms: [], total: 0 })

/** 分到模块 → 子文件夹 → GM；自定义 GM 进模块下的「自定义」文件夹 */
function build(entries: GmEntry[], g: GmStore, mods: Mods) {
  const byMod = new Map<string, Node>(mods.map((m) => [m.id, node(`m:${m.id}`, m.name)]))
  const unsorted = node(UNSORTED, t('未归模块'))
  for (const e of entries) {
    const place = e.custom ? { module: e.custom.module, folders: [t('自定义')] } : placeOf(e.key, e.group, g)
    let cur = (place.module && byMod.get(place.module)) || unsorted
    cur.total++
    for (const seg of place.folders) {
      const id = `${cur.id}/${e.custom ? '§custom' : seg}`
      let next = cur.kids.find((k) => k.id === id)
      if (!next) cur.kids.push((next = node(id, seg)))
      next.total++
      cur = next
    }
    cur.gms.push(e)
  }
  // 子文件夹按名字排，「自定义」总在最后
  const sort = (n: Node) => {
    n.kids.sort((a, b) => (a.id.endsWith('§custom') ? 1 : b.id.endsWith('§custom') ? -1 : a.name.localeCompare(b.name)))
    n.kids.forEach(sort)
  }
  const roots = [...byMod.values()]
  roots.forEach(sort)
  sort(unsorted)
  return { roots, unsorted }
}

export interface ModuleLineOpts {
  entries: GmEntry[]
  gm: GmStore
  mods: Mods
  /** 搜索时：命中的条目键；文件夹、模块有命中时自动展开 */
  hits?: Set<string>
  open: Set<string>
  toggle: (id: string) => void
  selected: string
  onPick: (e: GmEntry) => void
  onGmMenu: (e: MouseEvent, entry: GmEntry) => void
  onModuleMenu: (e: MouseEvent, id: string, count: number) => void
  /** 自定义 GM 的「Agent 加的」小徽标 */
  agentBadge: () => ReactNode
}

export function moduleLines(o: ModuleLineOpts): TreeLine[] {
  const { roots, unsorted } = build(o.entries, o.gm, o.mods)
  const out: TreeLine[] = []
  const gmLine = (e: GmEntry, depth: number): TreeLine => ({
    key: `gm:${e.key}`,
    depth,
    icon: e.src === 'custom' ? Crosshair : e.src === 'lua' ? FileCode : Wand2,
    iconTone: e.src === 'custom' || e.src === 'lua' ? 'ue:text-accent' : undefined,
    label: createElement(
      'span',
      null,
      createElement('span', { className: e.src === 'custom' ? undefined : 'ue:font-mono' }, e.name),
      e.desc && e.src !== 'custom' ? createElement('span', { className: 'ue:ml-1.5 ue:text-subtle' }, e.desc) : null,
      e.custom?.by === 'agent' ? createElement('span', { className: 'ue:ml-1.5' }, o.agentBadge()) : null,
    ),
    title: [e.name, e.desc, e.group].filter(Boolean).join('\n'),
    aside: e.src === 'cpp' ? 'C++' : undefined,
    expandable: false,
    open: false,
    selected: o.selected === `gm:${e.key}`,
    onSelect: () => o.onPick(e),
    onMenu: (ev) => o.onGmMenu(ev, e),
  })
  // 一个节点和它下面的行：子文件夹在前，再是直接挂着的 GM，「自定义」文件夹最后；搜索时没命中的整个节点不要
  const visit = (n: Node, depth: number, top: boolean, warn = false): TreeLine[] | undefined => {
    const gms = o.hits ? n.gms.filter((e) => o.hits!.has(e.key)) : n.gms
    const kids = n.kids.map((k) => ({ custom: k.id.endsWith('§custom'), lines: visit(k, depth + 1, false) }))
    if (o.hits && !gms.length && !kids.some((k) => k.lines)) return undefined
    const isOpen = !!o.hits || o.open.has(n.id)
    const modId = n.id.slice(2)
    const head: TreeLine = {
      key: n.id,
      depth,
      icon: top ? (warn ? CircleAlert : Package) : isOpen ? FolderOpen : Folder,
      iconTone: warn ? 'ue:text-warning' : undefined,
      label: warn ? createElement('span', { className: 'ue:text-warning' }, n.name) : n.name,
      title: warn ? t('这些 GM 没有分组：右键「移到模块…」放进一个模块') : undefined,
      aside: n.total,
      expandable: n.total > 0,
      open: isOpen,
      selected: false,
      clickToggles: true,
      onToggle: () => o.toggle(n.id),
      onSelect: () => undefined,
      onMenu: top && !warn ? (ev) => o.onModuleMenu(ev, modId, n.total) : undefined,
    }
    if (!isOpen) return [head]
    const sub = (custom: boolean) => kids.filter((k) => k.custom === custom).flatMap((k) => k.lines ?? [])
    return [head, ...sub(false), ...gms.map((e) => gmLine(e, depth + 1)), ...sub(true)]
  }
  for (const r of roots) out.push(...(visit(r, 0, true) ?? []))
  if (unsorted.total) out.push(...(visit(unsorted, 0, true, true) ?? []))
  return out
}
