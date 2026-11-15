import { Folder, FolderOpen, PersonStanding } from 'lucide-react'
import { useMemo } from 'react'
import { op, useLoad } from '../api.ts'
import { iconOf } from '../CompTree.tsx'
import { useUe } from '../ctx.tsx'
import { t } from '../host.ts'
import { useKept } from '../keep.ts'
import { TreeList, type TreeLine } from '../TreeList.tsx'
import { ErrorText, Note, SearchBox } from '../ui.tsx'
import { useExtEvents } from './uekit/ListCol.tsx'

interface OutActor {
  path: string
  name: string
  class: string
  label?: string
  folder?: string
  parent?: string
  player?: boolean
}
interface OutRes {
  world: string
  total: number
  items: OutActor[]
}

interface FolderNode {
  path: string
  name: string
  folders: Map<string, FolderNode>
  actors: OutActor[]
}

const nameOf = (a: OutActor) => a.label || a.name
const byName = (a: OutActor, b: OutActor) => nameOf(a).localeCompare(nameOf(b))

/** 文件夹树：大纲文件夹（A/B/C）一层层建；挂在别的 Actor 上的不进文件夹，跟在父 Actor 下面 */
function buildFolders(items: OutActor[], paths: Set<string>) {
  const root: FolderNode = { path: '', name: '', folders: new Map(), actors: [] }
  for (const a of items) {
    if (a.parent && paths.has(a.parent)) continue
    let node = root
    for (const seg of (a.folder ?? '').split('/').filter(Boolean)) {
      const p = node.path ? `${node.path}/${seg}` : seg
      let next = node.folders.get(seg)
      if (!next) {
        next = { path: p, name: seg, folders: new Map(), actors: [] }
        node.folders.set(seg, next)
      }
      node = next
    }
    node.actors.push(a)
  }
  return root
}

/**
 * 世界大纲（用户 2026-11-15）：当前目标世界里全部 Actor 的树，照 UE 的大纲按文件夹和挂接关系排；
 * 只列名字和类，属性等点了哪个再读（右边的属性栏）。编辑器里 Actor 增删、挂接变化时 UELink 推 uelink.outliner，
 * 收到就重读这一份列表，不轮询；游戏进程没有推送通道，点「刷新」
 */
export function Outliner({
  tick,
  selected,
  onSelect,
}: {
  tick: number
  selected: string
  onSelect: (path: string) => void
}) {
  const { project, target } = useUe()
  const kk = `${project.id}/actors`
  const [filter, setFilter] = useKept(`${kk}/filter`, '')
  const [closed, setClosed] = useKept<Record<string, boolean>>(`${kk}/closed`, {})
  const res = useLoad(
    () => op<OutRes>(project.id, 'outliner', { world: target.world }, target),
    [project.id, target.instance, target.world, tick],
    0,
    `${kk}/list`,
  )
  useExtEvents(project.id, (e) => {
    if (e.event !== 'uelink.outliner') return
    const worlds = (e.worlds as string[] | undefined) ?? []
    if (e.all || !res.data || worlds.includes(res.data.world)) void res.reload()
  })

  const lines = useMemo(() => {
    const items = res.data?.items ?? []
    const out: TreeLine[] = []
    const actorLine = (a: OutActor, depth: number, kids: number, aside?: string): TreeLine => ({
      key: a.path,
      depth,
      label: nameOf(a),
      icon: a.player ? PersonStanding : iconOf(a.class),
      expandable: kids > 0,
      open: !closed[a.path],
      selected: selected === a.path,
      title: `${nameOf(a)} (${a.class})`,
      aside: aside ?? (a.player ? t('玩家') : a.class),
      onToggle: () => setClosed((m) => ({ ...m, [a.path]: !m[a.path] })),
      onSelect: () => onSelect(a.path),
    })
    const q = filter.toLowerCase()
    if (q) {
      // 筛的时候不分层，摊平列出名字里包含的，右边小字写文件夹
      for (const a of items)
        if (nameOf(a).toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
          out.push(actorLine(a, 0, 0, a.folder || a.class))
      return out.sort((x, y) => String(x.label).localeCompare(String(y.label)))
    }
    const paths = new Set(items.map((a) => a.path))
    const kids = new Map<string, OutActor[]>()
    for (const a of items) if (a.parent && paths.has(a.parent)) kids.set(a.parent, [...(kids.get(a.parent) ?? []), a])
    const actor = (a: OutActor, depth: number, seen: Set<string>) => {
      const ch = seen.has(a.path) ? [] : (kids.get(a.path) ?? [])
      const line = actorLine(a, depth, ch.length)
      out.push(line)
      if (ch.length && line.open) {
        const next = new Set(seen).add(a.path)
        for (const k of [...ch].sort(byName)) actor(k, depth + 1, next)
      }
    }
    const folder = (f: FolderNode, depth: number) => {
      for (const sub of [...f.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        const key = `folder:${sub.path}`
        const open = !closed[key]
        out.push({
          key,
          depth,
          label: sub.name,
          icon: open ? FolderOpen : Folder,
          expandable: true,
          open,
          selected: false,
          onToggle: () => setClosed((m) => ({ ...m, [key]: !m[key] })),
        })
        if (open) folder(sub, depth + 1)
      }
      for (const a of [...f.actors].sort(byName)) actor(a, depth, new Set())
    }
    folder(buildFolders(items, paths), 0)
    return out
  }, [res.data, closed, filter, selected, onSelect, setClosed])

  return (
    <>
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-3">
        <SearchBox initial={filter} placeholder={t('筛 Actor 名字')} onSearch={setFilter} allowEmpty live />
        <ErrorText>{res.error}</ErrorText>
        {res.error.includes('不支持 outliner') && (
          <Note>{t('世界大纲要 UELink 2.2.0 及以上，到「桥接与权限」升级并在本地编译')}</Note>
        )}
        {res.data && (
          <span className="ue:text-footnote ue:text-subtle">
            {res.data.total > res.data.items.length
              ? t('共 {n} 个 Actor，只列前 {m} 个', { n: res.data.total, m: res.data.items.length })
              : t('{n} 个 Actor', { n: res.data.total })}
          </span>
        )}
      </div>
      <TreeList lines={lines} label={t('世界大纲')} />
    </>
  )
}
