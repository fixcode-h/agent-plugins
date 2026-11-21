import { Folder, FolderOpen, SquareTerminal, Wand2 } from 'lucide-react'
import { createElement, type MouseEvent } from 'react'
import { t } from '../../../host.ts'
import type { TreeLine } from '../../../TreeList.tsx'
import { groupKey, groupPath, type GmEntry } from '../data.ts'

/**
 * 引擎分类的树（规格第 6 节：引擎自带 GM 和控制台命令，按原分组）：分组按「 / 」拆成文件夹，GM 挂在最深那层；
 * 没分组的放「未分组」。搜索时只留有命中的文件夹并展开
 */
interface Folder_ {
  id: string
  name: string
  kids: Folder_[]
  gms: GmEntry[]
  total: number
}

function build(list: GmEntry[]) {
  const root: Folder_ = { id: '', name: '', kids: [], gms: [], total: 0 }
  for (const e of list) {
    let cur = root
    const segs = groupPath(e.group)
    for (const seg of segs.length ? segs : [t('未分组')]) {
      const id = `${cur.id}/${groupKey(seg)}`
      let next = cur.kids.find((k) => k.id === id)
      if (!next) cur.kids.push((next = { id, name: seg, kids: [], gms: [], total: 0 }))
      next.total++
      cur = next
    }
    cur.gms.push(e)
  }
  const sort = (f: Folder_) => {
    f.kids.sort((a, b) => a.name.localeCompare(b.name))
    f.kids.forEach(sort)
  }
  sort(root)
  return root.kids
}

export function groupLines(o: {
  entries: GmEntry[]
  hits?: Set<string>
  open: Set<string>
  toggle: (id: string) => void
  selected: string
  onPick: (e: GmEntry) => void
  onGmMenu: (e: MouseEvent, entry: GmEntry) => void
}): TreeLine[] {
  const gmLine = (e: GmEntry, depth: number): TreeLine => ({
    key: `gm:${e.key}`,
    depth,
    icon: e.src === 'console' ? SquareTerminal : Wand2,
    label: createElement(
      'span',
      null,
      createElement('span', { className: 'ue:font-mono' }, e.name),
      e.desc ? createElement('span', { className: 'ue:ml-1.5 ue:text-subtle' }, e.desc) : null,
    ),
    title: [e.name, e.desc, e.group].filter(Boolean).join('\n'),
    expandable: false,
    open: false,
    selected: o.selected === `gm:${e.key}`,
    onSelect: () => o.onPick(e),
    onMenu: (ev) => o.onGmMenu(ev, e),
  })
  const visit = (f: Folder_, depth: number): TreeLine[] | undefined => {
    const gms = o.hits ? f.gms.filter((e) => o.hits!.has(e.key)) : f.gms
    const kids = f.kids.map((k) => visit(k, depth + 1))
    if (o.hits && !gms.length && !kids.some(Boolean)) return undefined
    const isOpen = !!o.hits || o.open.has(`e${f.id}`)
    const head: TreeLine = {
      key: `e${f.id}`,
      depth,
      icon: isOpen ? FolderOpen : Folder,
      label: f.name,
      expandable: true,
      open: isOpen,
      selected: false,
      clickToggles: true,
      aside: f.total,
      onToggle: () => o.toggle(`e${f.id}`),
    }
    return isOpen ? [head, ...kids.flatMap((k) => k ?? []), ...gms.map((e) => gmLine(e, depth + 1))] : [head]
  }
  return build(o.entries).flatMap((f) => visit(f, 0) ?? [])
}
