import { Box, Eye, EyeOff, Folder, FolderOpen } from 'lucide-react'
import type { GtClassItem } from '../../../../../shared/gt-script/index.ts'
import { t } from '../../../../host.ts'
import { openMenu } from '../../../../menu.tsx'
import type { TreeLine } from '../../../../TreeList.tsx'
import { ancestors, luaDirOf, searchIndex, type ClassIndex } from './class-index-model.ts'
import type { ClassKind } from './data.ts'
import { KIND_ICON } from './kind-icon.ts'

/** Lua 模块名的最后一段（/ 和 . 都当分隔，和 gt.classes 的 dir 一致） */
export const luaLeaf = (name: string) => name.split(/[/.]/).filter(Boolean).pop() ?? name

/** 摊树要的东西：都来自 ClassPicker 的状态，放进一个对象传，不写大闭包 */
export interface LineCtx {
  ix: ClassIndex
  /** 搜索词（已去掉首尾空格；空 = 不搜） */
  q: string
  lua: boolean
  /** Lua 不定类时按目录列 */
  byDir: boolean
  /** 树从哪一层开始（Object、lockClass 或 Lua 的 ''） */
  root: string
  lockClass?: string
  lockLua: boolean
  kind?: ClassKind
  value: string
  onlyLive: boolean
  openSet: Set<string>
  toggle: (id: string) => void
  pick: (it: GtClassItem) => void
  ex: { dirs: string[]; isExcluded: (name: string) => boolean; remove: (d: string) => void; add: (d: string) => void }
  cn: (...c: (string | false | undefined)[]) => string
}

export interface ClassLines {
  lines: TreeLine[]
  /** 搜索命中总数（超过 SEARCH_MAX 时界面提示多打几个字） */
  total: number
  shown: number
}

const keepOf = (c: LineCtx) => (it: GtClassItem) => !c.onlyLive || !!it.live || it.kids > 0

/** 一行类：名字里命中的那段标出来，引擎自带的、锁定类之外的压灰 */
function rowOf(
  c: LineCtx,
  it: GtClassItem,
  depth: number,
  allowed: boolean,
  open?: { isOpen: boolean; onToggle: () => void },
): TreeLine {
  // Lua 模块名是完整路径，树里已经按目录分好了，只显示最后一段（目录放悬停提示）
  const name = it.kind === 'lua' ? luaLeaf(it.name) : it.name
  const word = c.q.toLowerCase().split(/\s+/)[0] ?? ''
  const at = word ? name.toLowerCase().indexOf(word) : -1
  const engine = !it.asset && it.kind !== 'lua'
  const id = c.lua ? `lua:${it.name}` : it.name
  return {
    key: `${depth}:${it.name}`,
    depth,
    icon: KIND_ICON[it.kind] ?? Box,
    iconTone: engine ? undefined : 'ue:text-accent',
    label: (
      <span className={c.cn('ue:font-mono', (engine || !allowed) && 'ue:opacity-55')}>
        {at >= 0 ? (
          <>
            {name.slice(0, at)}
            <b className="ue:text-accent">{name.slice(at, at + word.length)}</b>
            {name.slice(at + word.length)}
          </>
        ) : (
          name
        )}
      </span>
    ),
    aside: [
      it.kind === 'lua' ? 'Lua' : it.asset ? t('蓝图') : t('引擎 / C++'),
      it.live ? t('此刻 {n} 个', { n: it.live }) : '',
    ]
      .filter(Boolean)
      .join(' · '),
    title: [it.name, it.asset ?? it.file].filter(Boolean).join('\n'),
    expandable: !!open,
    open: open?.isOpen ?? false,
    selected: id === c.value,
    onToggle: open?.onToggle,
    onSelect: allowed ? () => c.pick(it) : undefined,
  }
}

/** 最下面的「排除」分类：排除的目录不在树里、不参与搜索，点一下或右键恢复 */
function excludedLines(c: LineCtx, out: TreeLine[]) {
  if (!c.ex.dirs.length) return
  const isOpen = c.openSet.has('excluded')
  out.push({
    key: 'excluded',
    depth: 0,
    icon: EyeOff,
    label: <span className="ue:text-subtle">{t('排除')}</span>,
    aside: String(c.ex.dirs.length),
    title: t('排除的目录不在树里、不参与搜索'),
    expandable: true,
    open: isOpen,
    selected: false,
    onToggle: () => c.toggle('excluded'),
    onSelect: () => c.toggle('excluded'),
  })
  if (isOpen)
    for (const d of c.ex.dirs)
      out.push({
        key: `excluded:${d}`,
        depth: 1,
        icon: Folder,
        label: <span className="ue:font-mono ue:opacity-55">{d}</span>,
        aside: t('恢复'),
        title: t('点一下恢复'),
        expandable: false,
        open: false,
        selected: false,
        onSelect: () => c.ex.remove(d),
        onMenu: (e) => openMenu(e, [{ label: t('恢复这个目录'), icon: Eye, onClick: () => c.ex.remove(d) }]),
      })
}

/** 类树往下摊（展开了的才往下）；inLock：已经在锁定类下面，可以选 */
function walkTree(c: LineCtx, out: TreeLine[], parent: string, depth: number, inLock: boolean, path: Set<string>) {
  const keep = keepOf(c)
  for (const it of c.ix.kids.get(parent) ?? []) {
    // 回包里子类写成自己、父子成环时不至于无限递归
    if (path.has(it.name) || !keep(it)) continue
    const isOpen = c.openSet.has(it.name)
    out.push(rowOf(c, it, depth, inLock, it.kids > 0 ? { isOpen, onToggle: () => c.toggle(it.name) } : undefined))
    if (isOpen && it.kids > 0) {
      path.add(it.name)
      walkTree(c, out, it.name, depth + 1, inLock, path)
      path.delete(it.name)
    }
  }
}

/** Lua 按目录：先子目录（文件夹行），再这个目录下的模块（能点开看子类） */
function walkDir(c: LineCtx, out: TreeLine[], dir: string, depth: number) {
  const here = c.ix.dirs.get(dir)
  if (!here) return
  for (const d of here.subs) {
    if (c.ex.isExcluded(d.name)) continue
    const id = `dir:${d.name}`
    const isOpen = c.openSet.has(id)
    out.push({
      key: id,
      depth,
      icon: isOpen ? FolderOpen : Folder,
      label: <span className="ue:font-mono">{luaLeaf(d.name)}</span>,
      aside: String(d.count),
      title: d.name,
      expandable: true,
      selected: false,
      open: isOpen,
      onToggle: () => c.toggle(id),
      onSelect: () => c.toggle(id),
      onMenu: (e) => openMenu(e, [{ label: t('排除这个目录'), icon: EyeOff, onClick: () => c.ex.add(d.name) }]),
    })
    if (isOpen) walkDir(c, out, d.name, depth + 1)
  }
  const keep = keepOf(c)
  for (const it of here.mods) {
    if (!keep(it)) continue
    const isOpen = c.openSet.has(it.name)
    out.push(rowOf(c, it, depth, true, it.kids > 0 ? { isOpen, onToggle: () => c.toggle(it.name) } : undefined))
    if (isOpen && it.kids > 0) walkTree(c, out, it.name, depth + 1, true, new Set([it.name]))
  }
}

/** Lua 搜索也按目录成树（用户 2026-11-21）：只按模块名（最后一段）比，所在目录全部展开 */
function luaHitLines(c: LineCtx, out: TreeLine[], hits: GtClassItem[]) {
  const subDirs = new Map<string, Set<string>>()
  const mods = new Map<string, GtClassItem[]>()
  for (const it of hits) {
    const parts = luaDirOf(it.name).split('/').filter(Boolean)
    for (let i = 0; i < parts.length; i++) {
      const up = parts.slice(0, i).join('/')
      subDirs.set(up, (subDirs.get(up) ?? new Set()).add(parts.slice(0, i + 1).join('/')))
    }
    const dir = parts.join('/')
    mods.set(dir, [...(mods.get(dir) ?? []), it])
  }
  const walk = (dir: string, depth: number) => {
    for (const d of [...(subDirs.get(dir) ?? [])].sort()) {
      out.push({
        key: `dir:${d}`,
        depth,
        icon: FolderOpen,
        label: <span className="ue:font-mono">{luaLeaf(d)}</span>,
        title: d,
        expandable: false,
        open: true,
        selected: false,
      })
      walk(d, depth + 1)
    }
    for (const it of mods.get(dir) ?? []) out.push(rowOf(c, it, depth, true))
  }
  walk('', 0)
}

/** 类树搜索：命中的和它们的祖先摊成树、全部展开；定了类时只有它和它下面的能选 */
function treeHitLines(c: LineCtx, out: TreeLine[], hits: GtClassItem[]) {
  const want = new Set<string>()
  for (const it of hits) {
    want.add(it.name)
    for (const a of ancestors(c.ix, it.name)) {
      if (want.has(a)) break
      want.add(a)
    }
  }
  const walk = (parent: string, depth: number, inLock: boolean, path: Set<string>) => {
    for (const it of c.ix.kids.get(parent) ?? []) {
      if (!want.has(it.name) || path.has(it.name)) continue
      const under = inLock || it.name === c.lockClass
      out.push(rowOf(c, it, depth, under, it.kids > 0 ? { isOpen: true, onToggle: () => undefined } : undefined))
      path.add(it.name)
      walk(it.name, depth + 1, under, path)
      path.delete(it.name)
    }
  }
  walk('', 0, !c.lockClass, new Set())
}

/** 按当前状态把类树摊成行（全在本地索引上算，不发请求） */
export function classLines(c: LineCtx): ClassLines {
  const out: TreeLine[] = []
  if (c.q) {
    const keep = keepOf(c)
    const { hits, total } = searchIndex(
      c.ix,
      c.q,
      c.byDir ? (it) => keep(it) && !c.ex.isExcluded(it.name) : (it) => !c.onlyLive || !!it.live,
    )
    if (c.byDir) {
      luaHitLines(c, out, hits)
      excludedLines(c, out)
    } else treeHitLines(c, out, hits)
    return { lines: out, total, shown: hits.length }
  }
  if (c.byDir) {
    walkDir(c, out, '', 0)
    excludedLines(c, out)
  } else if (c.root) {
    // 根（Object 或 lockClass）自己也是一行；lockClass 本身能选
    const self: GtClassItem = c.ix.byName.get(c.root) ?? {
      name: c.root,
      kind: c.lockLua ? 'lua' : c.lockClass ? (c.kind ?? 'object') : 'object',
      kids: 0,
    }
    const isOpen = c.openSet.has(c.root)
    out.push(rowOf(c, self, 0, true, { isOpen, onToggle: () => c.toggle(c.root) }))
    if (isOpen) walkTree(c, out, c.root, 1, true, new Set([c.root]))
  } else walkTree(c, out, '', 0, true, new Set())
  return { lines: out, total: 0, shown: 0 }
}
