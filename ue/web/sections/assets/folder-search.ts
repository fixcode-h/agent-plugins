import { useEffect, useMemo, useState } from 'react'
import { op } from '../../api.ts'
import { loadIndex, matchAssets, queryTerms, type LoadedIndex } from '../../jump/index-data.ts'

/**
 * 资源页文件夹树上方的搜索框（用户 2026-11-19：「文件夹 / 搜索」两个页签合成一个，在文件夹里直接搜）：
 * 打字时搜整个项目的资源，命中的资源和文件夹按所在目录摆成一棵树；清空回到原来的文件夹树。
 * 数据先用跳转弹窗那份本地索引（server/search-index：有 UEToVS 的索引读它，没有面板自己扫磁盘），
 * 第一次搜时才取（懒加载），打字只在网页里筛，不发请求、不碰 UE。
 * 本地索引只认得出蓝图和地图的类型；选了别的类型时改问 UE 的资源注册表（原「搜索」页签的 assets 操作）
 */

/** 一次最多摆多少个命中的资源进树：再多树就没法看了，提示用户再打几个字 */
export const SEARCH_MAX = 300
const FOLDER_MAX = 100
/** 本地索引里认得出的类型（server/search-index/uetovs.ts 的 blueprintClass、.umap） */
const INDEX_CLASSES = new Set([
  'blueprint',
  'widgetblueprint',
  'animblueprint',
  'editorutilitywidgetblueprint',
  'world',
])

export interface Hit {
  /** 对象路径 /Game/A/BP_X.BP_X */
  path: string
  name: string
  /** 所在文件夹 /Game/A */
  dir: string
  cls: string
}

/** 摊平后的一行：文件夹或资源，depth 是缩进 */
export type SNode =
  | { kind: 'folder'; path: string; name: string; depth: number; open: boolean; expandable: boolean; hit: boolean }
  | { kind: 'item'; hit: Hit; depth: number }

export interface SearchResult {
  nodes: SNode[]
  /** 命中的资源总数（截断前）+ 命中的文件夹数 */
  hits: number
  /** 资源超过 SEARCH_MAX 被截掉了 */
  capped: boolean
  loading: boolean
  error: string
  /** 用的是哪份数据：本地索引（及来源）还是 UE 的资源注册表 */
  source?: 'uetovs' | 'disk' | 'registry'
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
const lastSeg = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** 每份索引算一次所有文件夹（几万个资源也只在索引换了时算） */
const dirsOf = new WeakMap<LoadedIndex, { path: string; lname: string; lpath: string }[]>()
function indexDirs(idx: LoadedIndex) {
  let out = dirsOf.get(idx)
  if (out) return out
  const set = new Set<string>()
  for (const a of idx.assets) {
    const segs = a.dir.split('/').filter(Boolean)
    for (let i = 1; i <= segs.length; i++) set.add('/' + segs.slice(0, i).join('/'))
  }
  out = [...set].map((p) => ({ path: p, lname: lastSeg(p).toLowerCase(), lpath: p.toLowerCase() }))
  dirsOf.set(idx, out)
  return out
}

/** 在本地索引里搜：资源按跳转弹窗的排序取前 SEARCH_MAX 个；文件夹要名字里有第一个词、路径里有全部词 */
export function indexHits(idx: LoadedIndex, q: string, cls: string) {
  const terms = queryTerms(q)
  if (!terms.length) return { hits: [] as Hit[], total: 0, folders: [] as string[] }
  const c = cls.toLowerCase()
  const pool = c ? { ...idx, assets: idx.assets.filter((a) => a.cls.toLowerCase() === c) } : idx
  const m = matchAssets(pool, terms, SEARCH_MAX)
  const hits = m.rows.map((r) => ({ path: r.path, name: r.name, dir: r.dir, cls: r.cls }))
  // 选了类型就只找资源，文件夹不算命中
  const folders = c
    ? []
    : indexDirs(idx)
        .filter((d) => d.lname.includes(terms[0].replace(/^\/|\/$/g, '')) && terms.every((t) => d.lpath.includes(t)))
        .slice(0, FOLDER_MAX)
        .map((d) => d.path)
  return { hits, total: m.total, folders }
}

/**
 * 命中的资源和文件夹按目录摆成树，摊平成行：/Game 显示成 Content 排最前，其余挂载点（项目插件）按名字排。
 * 文件夹默认展开，folded 里记着用户收起的；命中的文件夹自己下面没有命中项时不能展开（点它在右栏看内容）
 */
export function layoutHits(hits: Hit[], folders: string[], folded: Record<string, boolean>): SNode[] {
  const tree = new Map<string, { folders: Set<string>; items: Hit[] }>()
  const node = (p: string) => {
    let n = tree.get(p)
    if (!n) tree.set(p, (n = { folders: new Set(), items: [] }))
    return n
  }
  const addDir = (dir: string) => {
    const segs = dir.split('/').filter(Boolean)
    let parent = '/'
    for (let i = 1; i <= segs.length; i++) {
      const p = '/' + segs.slice(0, i).join('/')
      node(parent).folders.add(p)
      node(p)
      parent = p
    }
  }
  for (const h of hits) {
    addDir(h.dir)
    node(h.dir).items.push(h)
  }
  for (const f of folders) addDir(f)
  const hitSet = new Set(folders)
  const out: SNode[] = []
  const walk = (p: string, depth: number) => {
    const n = node(p)
    const subs = [...n.folders].sort((a, b) =>
      a === '/Game' ? -1 : b === '/Game' ? 1 : byName(lastSeg(a), lastSeg(b)),
    )
    for (const f of subs) {
      const k = node(f)
      const expandable = k.folders.size + k.items.length > 0
      const open = expandable && !folded[f]
      out.push({
        kind: 'folder',
        path: f,
        name: f === '/Game' ? 'Content' : lastSeg(f),
        depth,
        open,
        expandable,
        hit: hitSet.has(f),
      })
      if (open) walk(f, depth + 1)
    }
    for (const h of [...n.items].sort((a, b) => byName(a.name, b.name))) out.push({ kind: 'item', hit: h, depth })
  }
  walk('/', 0)
  return out
}

/** 有字时才取本地索引（每次开始一轮新的搜索问一次服务端有没有变，没变直接用内存里的） */
function useIndex(pid: string, active: boolean) {
  const [idx, setIdx] = useState<LoadedIndex>()
  const [state, setState] = useState({ loading: false, error: '' })
  useEffect(() => {
    if (!active) return
    let live = true
    setState({ loading: true, error: '' })
    loadIndex(pid)
      .then((x) => live && (setIdx(x), setState({ loading: false, error: '' })))
      .catch((e: Error) => live && setState({ loading: false, error: e.message }))
    return () => {
      live = false
    }
  }, [pid, active])
  return { idx, ...state }
}

interface RegistryRow {
  path: string
  name: string
  class: string
  package: string
}

/** 选了本地索引认不出的类型：停手 400 毫秒后问 UE 的资源注册表（名字开头），编辑器没开时服务端会起后台编辑器 */
function useRegistry(pid: string, q: string, cls: string, active: boolean) {
  const [res, setRes] = useState<{ key: string; hits: Hit[]; total: number; error: string }>()
  const key = `${cls}|${q}`
  useEffect(() => {
    if (!active) return
    let live = true
    const timer = setTimeout(() => {
      op<{ items: RegistryRow[]; total: number }>(
        pid,
        'assets',
        { class: cls, prefix: q, path: '/Game', limit: SEARCH_MAX },
        undefined,
        15 * 60000,
      )
        .then((r) => {
          if (!live) return
          const hits = (r.items ?? []).map((a) => ({
            path: a.path,
            name: a.name,
            dir: a.package.slice(0, a.package.lastIndexOf('/')),
            cls: a.class,
          }))
          setRes({ key, hits, total: Number(r.total) || hits.length, error: '' })
        })
        .catch((e: Error) => live && setRes({ key, hits: [], total: 0, error: e.message }))
    }, 400)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // key 里已经有 q 和 cls
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, key, active])
  return res?.key === key ? res : undefined
}

/** 树搜索的数据：q 为空时不取、不算 */
export function useFolderSearch(
  pid: string,
  q: string,
  cls: { name: string; path?: string },
  folded: Record<string, boolean>,
): SearchResult {
  const text = q.trim()
  // 本地索引没 UEToVS 时是面板扫盘建的，只认得出地图：这时按蓝图类型筛也得问注册表
  const [diskIndex, setDiskIndex] = useState(false)
  const lc = cls.name.toLowerCase()
  const registry = !!lc && (!INDEX_CLASSES.has(lc) || (lc !== 'world' && diskIndex))
  const index = useIndex(pid, !!text && !registry)
  const src = index.idx?.source.assets
  useEffect(() => {
    if (src) setDiskIndex(src === 'disk')
  }, [src])
  const reg = useRegistry(pid, text, cls.path || cls.name, !!text && registry)
  const found = useMemo(() => {
    if (!text) return undefined
    if (registry) return reg && { hits: reg.hits, total: reg.total, folders: [] as string[] }
    return index.idx && indexHits(index.idx, text, cls.name)
  }, [text, cls.name, registry, reg, index.idx])
  const nodes = useMemo(() => (found ? layoutHits(found.hits, found.folders, folded) : []), [found, folded])
  return {
    nodes,
    hits: found ? found.total + found.folders.length : 0,
    capped: !!found && found.total > found.hits.length,
    loading: registry ? !reg : index.loading && !index.idx,
    error: registry ? (reg?.error ?? '') : index.error,
    source: registry ? 'registry' : index.idx?.source.assets,
  }
}
