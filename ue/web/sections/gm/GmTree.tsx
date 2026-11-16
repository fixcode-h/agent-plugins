import { pinyinInitials } from '@panel/shared/pinyin'
import { CirclePlus, FileCode, Folder, FolderOpen, History, ListVideo, Plus, Star, Wand2 } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import type { GmMacro } from '../../../server/types.ts'
import { h, t } from '../../host.ts'
import { useKept } from '../../keep.ts'
import { TreeList, type TreeLine } from '../../TreeList.tsx'
import { SearchBox } from '../../ui.tsx'
import { groupKey, groupPath, search, type GmEntry } from './data.ts'

export type GmSrcFilter = 'all' | 'lua' | 'cpp' | 'engine'

/** 树上点的是哪一行：GM（带收藏、最近执行里那组参数）或宏 */
export type GmPick = { kind: 'gm'; line: string; key: string; args?: string[] } | { kind: 'macro'; id: string }

interface Folder {
  id: string
  name: string
  kids: Folder[]
  gms: GmEntry[]
  total: number
}

/** 分组按「 / 」拆成文件夹，GM 挂在最深那层；没分组的放「未分组」 */
function buildTree(list: GmEntry[]) {
  const root: Folder = { id: '', name: '', kids: [], gms: [], total: 0 }
  for (const e of list) {
    let cur = root
    const segs = groupPath(e.group)
    for (const seg of segs.length ? segs : [t('未分组')]) {
      const id = `${cur.id}/${groupKey(seg)}`
      let next = cur.kids.find((k) => k.id === id)
      if (!next) {
        next = { id, name: seg, kids: [], gms: [], total: 0 }
        cur.kids.push(next)
      }
      next.total++
      cur = next
    }
    cur.gms.push(e)
  }
  const sort = (f: Folder) => {
    f.kids.sort((a, b) => a.name.localeCompare(b.name))
    f.kids.forEach(sort)
  }
  sort(root)
  return root.kids
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const nameHit = (name: string, k: string) => !!k && (norm(name).includes(k) || pinyinInitials(norm(name)).includes(k))

/**
 * GM 页左边的一棵树（用户 2026-11-16：分组上百个、Lua GM 上千条，左栏分组 + 中间列表两栏太挤，合成一棵树）。
 * 顶上搜索（名字、说明、参数、分组名，分组名也认拼音首字母）和来源切换；树里收藏、最近执行、宏在最上面，
 * 下面是按「 / 」拆层的分组文件夹，GM 挂在文件夹里。搜索时有命中的文件夹自动展开。用共用的 TreeList（只画看得见的行）
 */
export function GmTree({
  entries,
  favs,
  recent,
  macros,
  src,
  onSrc,
  counts,
  q,
  onQ,
  selected,
  onPick,
  onNewMacro,
  onAdd,
  footer,
}: {
  /** 已按来源筛过的 GM */
  entries: GmEntry[]
  favs: { entry: GmEntry; args: string[] }[]
  recent: { entry: GmEntry; args: string[]; ok: boolean; at: string }[]
  macros: GmMacro[]
  src: GmSrcFilter
  onSrc: (s: GmSrcFilter) => void
  counts: Record<GmSrcFilter, number>
  q: string
  onQ: (q: string) => void
  /** 选中那一行的 key */
  selected: string
  onPick: (p: GmPick) => void
  onNewMacro: () => void
  /** 正在编辑宏：GM 行尾出 ＋，点了加进宏 */
  onAdd?: (e: GmEntry, args?: string[]) => void
  footer?: ReactNode
}) {
  const { ui } = h()
  const [openList, setOpenList] = useKept<string[]>('gm-tree-open', ['§fav', '§macro'])
  const open = useMemo(() => new Set(openList), [openList])
  const toggle = (id: string) => setOpenList((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  const k = norm(q)
  const tree = useMemo(() => buildTree(entries), [entries])
  // 搜 GM 的名字、说明、参数；一次算好命中的 key，文件夹按它判断留不留
  const hits = useMemo(() => (q ? new Set(search(entries, q).map((e) => e.key)) : undefined), [entries, q])

  const lines = useMemo(() => {
    const out: TreeLine[] = []
    const gmLine = (e: GmEntry, depth: number, line: string, args?: string[], note?: ReactNode): TreeLine => ({
      key: line,
      depth,
      icon: e.src === 'lua' ? FileCode : Wand2,
      iconTone: e.src === 'lua' ? 'ue:text-accent-text' : undefined,
      label: (
        <>
          <span className="ue:font-mono">{e.name}</span>
          {args?.length ? (
            <span className="ue:font-mono ue:text-muted"> {args.join(' ')}</span>
          ) : e.desc ? (
            <span className="ue:text-subtle"> {e.desc}</span>
          ) : null}
        </>
      ),
      title: [e.name, e.desc, e.group].filter(Boolean).join('\n'),
      expandable: false,
      open: false,
      selected: selected === line,
      aside: note,
      onSelect: () => onPick({ kind: 'gm', line, key: e.key, args }),
      action: onAdd ? (
        <button
          type="button"
          title={t('加到正在编辑的宏')}
          onClick={(ev) => {
            ev.stopPropagation()
            onAdd(e, args)
          }}
          className="ue:grid ue:cursor-pointer ue:text-subtle ue:hover:text-accent"
        >
          <CirclePlus className="ue:h-3.5 ue:w-3.5" />
        </button>
      ) : undefined,
      actionShown: !!onAdd,
    })
    const section = (
      id: string,
      icon: TreeLine['icon'],
      label: string,
      n: number,
      kids: TreeLine[],
      action?: ReactNode,
    ) => {
      // 搜索时：收藏、最近里没命中的整段不显示
      if (q && !kids.length) return
      const isOpen = q ? true : open.has(id)
      out.push({
        key: id,
        depth: 0,
        icon,
        label: <span className="ue:font-medium">{label}</span>,
        expandable: kids.length > 0,
        open: isOpen,
        selected: false,
        aside: n || undefined,
        onToggle: () => toggle(id),
        action,
        actionShown: !!action,
      })
      if (isOpen) out.push(...kids)
    }
    const want = (e: GmEntry) => !hits || hits.has(e.key)
    section(
      '§fav',
      Star,
      t('收藏'),
      favs.length,
      favs.flatMap((f, i) => (want(f.entry) ? [gmLine(f.entry, 1, `fav:${i}`, f.args)] : [])),
    )
    section(
      '§recent',
      History,
      t('最近执行'),
      recent.length,
      recent
        .slice(0, 30)
        .flatMap((r, i) =>
          want(r.entry) ? [gmLine(r.entry, 1, `run:${i}`, r.args, new Date(r.at).toLocaleTimeString())] : [],
        ),
    )
    section(
      '§macro',
      ListVideo,
      t('宏'),
      macros.length,
      macros
        .filter((m) => !k || nameHit(m.name, k))
        .map((m) => ({
          key: `macro:${m.id}`,
          depth: 1,
          icon: ListVideo,
          label: m.name,
          expandable: false,
          open: false,
          selected: selected === `macro:${m.id}`,
          aside: t('{n} 步', { n: m.steps.length }),
          onSelect: () => onPick({ kind: 'macro', id: m.id }),
        })),
      q ? undefined : (
        <button
          type="button"
          title={t('新建宏')}
          onClick={(ev) => {
            ev.stopPropagation()
            onNewMacro()
          }}
          className="ue:grid ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
        >
          <Plus className="ue:h-3.5 ue:w-3.5" />
        </button>
      ),
    )
    // 分组文件夹：搜索时文件夹名命中就整个留着（收起，点开看），否则只留有命中 GM 的、并展开
    const visit = (f: Folder, depth: number, forced: boolean): boolean => {
      const self = forced || nameHit(f.name, k)
      const at = out.length
      out.push(undefined as unknown as TreeLine)
      const mark = out.length
      let any = !q || self
      for (const c of f.kids) if (visit(c, depth + 1, self)) any = true
      const gms = !q || self ? f.gms : f.gms.filter(want)
      if (gms.length) any = true
      if (!any) {
        out.length = at
        return false
      }
      // 搜索时有命中的都展开：文件夹名命中的直接看到里面的 GM
      const isOpen = q ? true : open.has(f.id)
      if (isOpen) for (const e of gms) out.push(gmLine(e, depth + 1, `gm:${e.key}`))
      else out.length = mark
      out[at] = {
        key: f.id,
        depth,
        icon: isOpen ? FolderOpen : Folder,
        label: f.name,
        expandable: true,
        open: isOpen,
        selected: false,
        aside: f.total,
        onToggle: () => toggle(f.id),
      }
      return true
    }
    for (const f of tree) visit(f, 0, false)
    return out
    // onPick、onAdd 每次渲染都是新函数；行跟着数据、搜索、展开和选中变就够了
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, hits, k, open, selected, favs, recent, macros, !!onAdd])

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-3">
        <SearchBox initial={q} placeholder={t('GM 名字、说明、参数或分组')} onSearch={onQ} allowEmpty live />
        <ui.Segmented
          size="sm"
          label={t('来源')}
          value={src}
          onChange={onSrc}
          options={[
            { id: 'all' as const, label: t('全部 {n}', { n: counts.all }) },
            { id: 'lua' as const, label: `Lua ${counts.lua}` },
            { id: 'cpp' as const, label: `C++ ${counts.cpp}` },
            { id: 'engine' as const, label: t('引擎 {n}', { n: counts.engine }) },
          ]}
        />
      </div>
      {lines.length ? (
        <TreeList lines={lines} label={t('GM')} />
      ) : (
        <p className="ue:flex-1 ue:p-4 ue:text-footnote ue:text-subtle">
          {q ? t('没有名字、说明、参数或分组里含「{q}」的 GM', { q }) : t('这里没有 GM')}
        </p>
      )}
      {footer}
    </div>
  )
}
