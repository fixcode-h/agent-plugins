import { startTransition, useEffect, useMemo, useState } from 'react'
import { op } from '../../api.ts'
import { searchIndex } from '../../jump/index-async.ts'
import { loadIndex, type LoadedIndex } from '../../jump/index-data.ts'

/**
 * 资源页文件夹树上方的搜索框（用户 2026-11-19：「文件夹 / 搜索」两个页签合成一个，在文件夹里直接搜）：
 * 打字时搜整个项目的资源，命中的资源和文件夹按所在目录摆成一棵树；清空回到原来的文件夹树。
 * 数据先用跳转弹窗那份本地索引（server/search-index：有 UEToVS 的索引读它，没有面板自己扫磁盘），
 * 点进搜索框就开始取（懒加载），打字只在网页里筛，不发请求、不碰 UE。
 * 本地索引只认得出蓝图和地图的类型；选了别的类型时改问 UE 的资源注册表（原「搜索」页签的 assets 操作）。
 *
 * 不卡（用户 2026-11-20「异步搜索，不要卡顿，回车就全力搜，输入过程中可以异步 index」）：
 * 打字时停手一小会儿才搜，搜也是分片、可作废的（jump/index-async.ts），结果出来前先留着上一次的；
 * 按回车不等、立刻搜，每片给的时间更长、列得更多（SEARCH_FULL）
 */

/** 打字时一次最多摆多少个命中的资源进树：再多树就没法看了，提示用户再打几个字或按回车 */
export const SEARCH_MAX = 300
/** 按回车「全力搜」时最多列多少个（树是虚拟滚动的，多列只是多几屏） */
export const SEARCH_FULL = 3000
const FOLDER_MAX = 100
const FOLDER_FULL = 500
/** 打字时停手多久才搜：连着打字只搜最后一次 */
const TYPE_DELAY = 150
/** 每片最多占主线程多久：打字时短一点保输入框跟手，回车时长一点搜得快 */
const TYPE_BUDGET = 8
const FULL_BUDGET = 40
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
  /** 资源超过这次能列的个数（limit）被截掉了 */
  capped: boolean
  /** 这次最多列几个：打字时 SEARCH_MAX，按了回车 SEARCH_FULL */
  limit: number
  /** 是不是按回车搜出来的（全力搜） */
  full: boolean
  /** 正在显示的结果是按哪个关键词搜的（新的还没搜完时先留着上一次的，高亮要跟结果对上） */
  q: string
  loading: boolean
  error: string
  /** 用的是哪份数据：本地索引（及来源）还是 UE 的资源注册表 */
  source?: 'uetovs' | 'disk' | 'registry'
}

// 回车能列几千个：Collator 比每次 localeCompare 快得多
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const byName = collator.compare
const lastSeg = (p: string) => p.slice(p.lastIndexOf('/') + 1)

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

/** 点进搜索框或有字时就取本地索引（每轮问一次服务端有没有变，没变直接用内存里的；转换是分片的，不卡输入） */
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

interface Found {
  /** 这份结果对应的「类型|关键词|是否全力」 */
  key: string
  q: string
  full: boolean
  hits: Hit[]
  total: number
  folders: string[]
  error: string
}

/** 这一次该怎么搜：打字时等一会儿、少列，按了回车（回车时的关键词和现在一样）立刻、多列 */
function plan(text: string, enterQ: string) {
  const full = !!text && enterQ === text
  return {
    full,
    delay: full ? 0 : TYPE_DELAY,
    limit: full ? SEARCH_FULL : SEARCH_MAX,
    folderLimit: full ? FOLDER_FULL : FOLDER_MAX,
    budgetMs: full ? FULL_BUDGET : TYPE_BUDGET,
  }
}

/** 在本地索引里搜：停手后分片搜，新一轮开始旧的作废；结果用 transition 交给界面，不和打字抢 */
function useIndexHits(idx: LoadedIndex | undefined, text: string, cls: string, enterQ: string, active: boolean) {
  const [res, setRes] = useState<Found>()
  const p = plan(text, enterQ)
  const key = `${cls}|${text}|${p.full ? 1 : 0}`
  useEffect(() => {
    if (!active || !idx) return
    const cancel = { aborted: false }
    const timer = setTimeout(() => {
      void searchIndex(idx, text, cls, { ...p, cancel }).then((r) => {
        if (!r || cancel.aborted) return
        const hits = r.rows.map((x) => ({ path: x.path, name: x.name, dir: x.dir, cls: x.cls }))
        startTransition(() =>
          setRes({ key, q: text, full: p.full, hits, total: r.total, folders: r.folders, error: '' }),
        )
      })
    }, p.delay)
    return () => {
      cancel.aborted = true
      clearTimeout(timer)
    }
    // key 里已经有 text、cls 和是否全力
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, key, active])
  return { res, fresh: res?.key === key }
}

interface RegistryRow {
  path: string
  name: string
  class: string
  package: string
}

/** 选了本地索引认不出的类型：停手 400 毫秒后（按回车就立刻）问 UE 的资源注册表（名字开头），编辑器没开时服务端会起后台编辑器 */
function useRegistry(pid: string, q: string, cls: string, enterQ: string, active: boolean) {
  const [res, setRes] = useState<Found>()
  const full = !!q && enterQ === q
  const key = `${cls}|${q}|${full ? 1 : 0}`
  useEffect(() => {
    if (!active) return
    let live = true
    const timer = setTimeout(
      () => {
        op<{ items: RegistryRow[]; total: number }>(
          pid,
          'assets',
          { class: cls, prefix: q, path: '/Game', limit: full ? SEARCH_FULL : SEARCH_MAX },
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
            const total = Number(r.total) || hits.length
            startTransition(() => setRes({ key, q, full, hits, total, folders: [], error: '' }))
          })
          .catch((e: Error) => live && setRes({ key, q, full, hits: [], total: 0, folders: [], error: e.message }))
      },
      full ? 0 : 400,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
    // key 里已经有 q、cls 和是否全力
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, key, active])
  return { res, fresh: res?.key === key }
}

/**
 * 树搜索的数据：q 为空时不搜、不算。
 * focused：搜索框有焦点（还没打字就先把索引取好）；enterQ：最近一次按回车时的关键词，和 q 一样就是「全力搜」
 */
export function useFolderSearch(
  pid: string,
  q: string,
  cls: { name: string; path?: string },
  folded: Record<string, boolean>,
  opt: { focused?: boolean; enterQ?: string } = {},
): SearchResult {
  const text = q.trim()
  const enterQ = (opt.enterQ ?? '').trim()
  // 本地索引没 UEToVS 时是面板扫盘建的，只认得出地图：这时按蓝图类型筛也得问注册表
  const [diskIndex, setDiskIndex] = useState(false)
  const lc = cls.name.toLowerCase()
  const registry = !!lc && (!INDEX_CLASSES.has(lc) || (lc !== 'world' && diskIndex))
  const index = useIndex(pid, (!!text || !!opt.focused) && !registry)
  const src = index.idx?.source.assets
  useEffect(() => {
    if (src) setDiskIndex(src === 'disk')
  }, [src])
  const local = useIndexHits(index.idx, text, cls.name, enterQ, !!text && !registry)
  const reg = useRegistry(pid, text, cls.path || cls.name, enterQ, !!text && registry)
  const cur = registry ? reg : local
  // 新的还没出来先留着上一次的（换了数据来源的不留）：不一下子清空成「搜索中…」
  const shown = text ? cur.res : undefined
  const nodes = useMemo(() => (shown ? layoutHits(shown.hits, shown.folders, folded) : []), [shown, folded])
  const limit = shown?.full ? SEARCH_FULL : SEARCH_MAX
  return {
    nodes,
    hits: shown ? shown.total + shown.folders.length : 0,
    capped: !!shown && shown.total > shown.hits.length,
    limit,
    full: !!shown?.full,
    q: shown?.q ?? '',
    loading: !!text && (!cur.fresh || (!registry && index.loading && !index.idx)),
    error: registry ? (reg.res?.error ?? '') : index.error,
    source: registry ? 'registry' : index.idx?.source.assets,
  }
}
