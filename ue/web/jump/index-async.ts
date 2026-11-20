import { queryTerms, score, type AssetRow, type LoadedIndex } from './index-match.ts'

/**
 * 本地索引的异步搜索（用户 2026-11-20：资源页搜索框在大项目里打字卡）：
 * 原来每按一个键就在主线程上把整份索引（几万个资源）扫一遍、全量排序，一个字母能命中几乎全部，界面跟着卡。
 * 这里改成：
 * - 分片扫：每扫一小段看一眼用时，超了预算就把主线程让出去（输入框照常响应），新的一次搜索开始时旧的作废；
 * - 增量：新关键词是上一次的延续（逐个词包含旧词，打字往后加字就是这样）时，只在上一次命中的里面再筛；
 * - 只排前 limit 个：按「档位 + 名字长度」分桶，只给要用的那几桶排序，不再整份排序。
 * 不依赖 React，单测直接跑（index-async.test.ts）
 */

/** 中途作废：新的一次搜索开始时把旧的标成 aborted */
export interface Cancel {
  aborted: boolean
}

export interface DirRow {
  path: string
  lname: string
  lpath: string
}

export interface AsyncHits {
  rows: AssetRow[]
  /** 命中的资源总数（截断前） */
  total: number
  /** 命中的文件夹（最多 folderLimit 个） */
  folders: string[]
}

/** 让出主线程一下：MessageChannel 比 setTimeout(0) 快（后者嵌套多了会被拉到 4 毫秒） */
export function yieldUi(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0))
  return new Promise((r) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      r()
    }
    ch.port2.postMessage(0)
  })
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** 分片跑一个循环：每 256 项看一次用时，超了 budgetMs 让出主线程；作废了返回 false */
export async function sliced<T>(list: T[], budgetMs: number, cancel: Cancel | undefined, each: (x: T) => void) {
  let until = now() + budgetMs
  for (let i = 0; i < list.length; i++) {
    each(list[i])
    if ((i & 255) === 255 && now() > until) {
      await yieldUi()
      if (cancel?.aborted) return false
      until = now() + budgetMs
    }
  }
  return !cancel?.aborted
}

/** 分片把一个大数组转换一遍（取到索引时算小写之类），不一口气卡住主线程 */
export async function mapSliced<T, R>(list: T[], fn: (x: T) => R, budgetMs = 12): Promise<R[]> {
  const out: R[] = []
  await sliced(list, budgetMs, undefined, (x) => {
    out.push(fn(x))
  })
  return out
}

/** 每份索引的全部文件夹，分片算一次（索引换了才重算） */
const dirsOf = new WeakMap<LoadedIndex, Promise<DirRow[]>>()
export function indexDirs(idx: LoadedIndex): Promise<DirRow[]> {
  let p = dirsOf.get(idx)
  if (p) return p
  p = (async () => {
    const set = new Set<string>()
    await sliced(idx.assets, 12, undefined, (a) => {
      let at = a.dir.indexOf('/', 1)
      while (at > 0) {
        set.add(a.dir.slice(0, at))
        at = a.dir.indexOf('/', at + 1)
      }
      if (a.dir.length > 1) set.add(a.dir)
    })
    return [...set].map((path) => ({
      path,
      lname: path.slice(path.lastIndexOf('/') + 1).toLowerCase(),
      lpath: path.toLowerCase(),
    }))
  })()
  dirsOf.set(idx, p)
  return p
}

/** 新词组是不是旧词组的延续：词数不少，前面每个词都包含旧词。是的话新的命中一定在旧的命中里 */
export function refines(prev: string[], next: string[]) {
  if (next.length < prev.length) return false
  return prev.every((t, i) => next[i].includes(t))
}

/** 只给前 limit 个排序：按档位、名字长度分桶，桶号从小往大取，只排要用到的桶 */
export function topK(hits: { r: AssetRow; s: number }[], limit: number): AssetRow[] {
  const buckets = new Map<number, AssetRow[]>()
  for (const h of hits) {
    const k = h.s * 1024 + Math.min(h.r.lname.length, 1023)
    const b = buckets.get(k)
    if (b) b.push(h.r)
    else buckets.set(k, [h.r])
  }
  const out: AssetRow[] = []
  for (const k of [...buckets.keys()].sort((a, b) => a - b)) {
    const b = buckets.get(k)!
    b.sort((x, y) => (x.lname < y.lname ? -1 : x.lname > y.lname ? 1 : 0))
    for (const r of b) {
      if (out.length >= limit) return out
      out.push(r)
    }
  }
  return out
}

/** 上一次的完整命中（不截断），给下一次增量用；按索引对象、类型区分 */
let last: { idx: LoadedIndex; cls: string; terms: string[]; assets: AssetRow[]; dirs: DirRow[] } | undefined

/**
 * 在本地索引里搜资源和文件夹：资源按跳转弹窗的排序取前 limit 个；文件夹要名字里有第一个词、路径里有全部词。
 * 选了类型（cls）就只找这个类型的资源，文件夹不算命中。作废了返回 undefined
 */
export async function searchIndex(
  idx: LoadedIndex,
  q: string,
  cls: string,
  opt: { limit: number; folderLimit: number; budgetMs: number; cancel?: Cancel },
): Promise<AsyncHits | undefined> {
  const terms = queryTerms(q)
  if (!terms.length) return { rows: [], total: 0, folders: [] }
  const c = cls.toLowerCase()
  const base = last && last.idx === idx && last.cls === c && refines(last.terms, terms) ? last : undefined
  const pool = base ? base.assets : idx.assets
  const assets: AssetRow[] = []
  const scored: { r: AssetRow; s: number }[] = []
  const ok = await sliced(pool, opt.budgetMs, opt.cancel, (r) => {
    if (c && !base && r.cls.toLowerCase() !== c) return
    const s = score(r.lname, r.lpath, terms)
    if (s < 0) return
    assets.push(r)
    scored.push({ r, s })
  })
  if (!ok) return undefined
  const dirs: DirRow[] = []
  if (!c) {
    const dirPool = base ? base.dirs : await indexDirs(idx)
    if (opt.cancel?.aborted) return undefined
    const t0 = terms[0].replace(/^\/|\/$/g, '')
    const dirOk = await sliced(dirPool, opt.budgetMs, opt.cancel, (d) => {
      if (d.lname.includes(t0) && terms.every((t) => d.lpath.includes(t))) dirs.push(d)
    })
    if (!dirOk) return undefined
  }
  last = { idx, cls: c, terms, assets, dirs }
  return {
    rows: topK(scored, opt.limit),
    total: assets.length,
    folders: dirs.slice(0, opt.folderLimit).map((d) => d.path),
  }
}
