import type { IndexAsset, IndexLua, SearchIndex } from '../../server/search-index/types.ts'

/**
 * 跳转索引的筛选和排序（不依赖 React 和接口，单测直接跑）：数据由 index-data.ts 取来并预先算好小写
 */

export interface AssetRow {
  /** 对象路径 /Game/A/BP_X.BP_X */
  path: string
  name: string
  /** 包所在目录 /Game/A */
  dir: string
  cls: string
  parent?: string
  lname: string
  lpath: string
}

export interface LuaRow {
  module: string
  file: string
  lname: string
  /** 模块名和 / 写法都能搜：ui.bagpanel ui/bagpanel */
  lpath: string
}

export interface LoadedIndex {
  version: string
  assets: AssetRow[]
  lua: LuaRow[]
  source: SearchIndex['source']
}

export function toAsset([path, cls, parent]: IndexAsset): AssetRow {
  const pkg = path.split('.')[0]
  const cut = pkg.lastIndexOf('/')
  const name = pkg.slice(cut + 1)
  return { path, name, dir: pkg.slice(0, cut), cls, parent, lname: name.toLowerCase(), lpath: pkg.toLowerCase() }
}

export function toLua([module, file]: IndexLua): LuaRow {
  const lname = module.toLowerCase()
  return { module, file, lname, lpath: `${lname} ${lname.replace(/\./g, '/')}` }
}

/**
 * 输入整理成小写的几个词：磁盘路径的反斜杠换成 /，.uasset 后缀、对象路径的 .Name 去掉，
 * 磁盘路径里 Content/ 之前的部分丢掉（剩下的相对路径照样能在包路径里找到）
 */
export function queryTerms(q: string): string[] {
  let s = q.trim().toLowerCase().replace(/\\/g, '/')
  s = s.replace(/\.(uasset|umap)$/, '')
  const i = s.lastIndexOf('/content/')
  if (i >= 0) s = s.slice(i + '/content'.length)
  // 对象路径 /Game/A/BP.BP、BP.BP_C：只要包路径部分
  if (s.includes('/')) s = s.replace(/\.[^/]*$/, '')
  else s = s.replace(/^([^/.\s]+)\.\1(_c)?$/, '$1')
  return s.split(/\s+/).filter(Boolean)
}

/**
 * 排序：名字完全一样 < 名字开头 < 名字里有 < 只有路径里有；同档名字短的在前。
 * 所有词都要出现（第一个词决定档位），这样「hero bp」「ui/bag」都能搜
 */
function score(lname: string, lpath: string, terms: string[]) {
  for (const t of terms) if (!lpath.includes(t) && !lname.includes(t)) return -1
  const t0 = terms[0]
  // 贴的是路径：整条对上最前，路径结尾对上（相对路径）其次
  if (t0.includes('/')) return lpath === t0 ? 0 : lpath.endsWith(t0) ? 1 : 3
  const name = lname.indexOf(t0)
  if (lname === t0) return 0
  if (name === 0) return 1
  if (name > 0) return 2
  return 3
}

export interface Matched<T> {
  rows: T[]
  total: number
}

export function matchRows<T>(list: T[], terms: string[], key: (r: T) => [string, string], limit: number): Matched<T> {
  if (!terms.length) return { rows: [], total: 0 }
  const hits: { r: T; s: number; n: string }[] = []
  for (const r of list) {
    const [lname, lpath] = key(r)
    const s = score(lname, lpath, terms)
    if (s >= 0) hits.push({ r, s, n: lname })
  }
  hits.sort((a, b) => a.s - b.s || a.n.length - b.n.length || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0))
  return { rows: hits.slice(0, limit).map((h) => h.r), total: hits.length }
}

export const matchAssets = (idx: LoadedIndex | undefined, terms: string[], limit: number) =>
  matchRows(idx?.assets ?? [], terms, (r) => [r.lname, r.lpath], limit)

export const matchLua = (idx: LoadedIndex | undefined, terms: string[], limit: number) =>
  matchRows(idx?.lua ?? [], terms, (r) => [r.lname.slice(r.lname.lastIndexOf('.') + 1), r.lpath], limit)
