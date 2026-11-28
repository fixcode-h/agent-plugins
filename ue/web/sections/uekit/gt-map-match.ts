import { matchRows, queryTerms, type AssetRow, type LoadedIndex } from '../../jump/index-match.ts'

/**
 * 「地图」输入框的候选：从跳转弹窗同一份本地索引里挑出关卡（类名 World；扫磁盘的索引按 .umap 记成 World），
 * 打字只在网页里筛，不发请求、不碰 UE。填进去的是包路径（/Game/Maps/Main），level.load、pie.start 都认
 */
export interface MapHit {
  /** 包路径 /Game/Maps/Main */
  pkg: string
  name: string
}

const pool = new WeakMap<LoadedIndex, AssetRow[]>()

function maps(idx: LoadedIndex) {
  let rows = pool.get(idx)
  if (rows) return rows
  rows = idx.assets.filter((r) => r.cls === 'World')
  rows.sort((a, b) => (a.lpath < b.lpath ? -1 : a.lpath > b.lpath ? 1 : 0))
  pool.set(idx, rows)
  return rows
}

/** 按输入筛关卡；空输入列前 limit 个。all 是索引里一共几张图 */
export function matchMaps(idx: LoadedIndex | undefined, q: string, limit: number) {
  if (!idx) return { rows: [] as MapHit[], total: 0, all: 0 }
  const p = maps(idx)
  const terms = queryTerms(q)
  const hit = terms.length
    ? matchRows(p, terms, (r) => [r.lname, r.lpath], limit)
    : { rows: p.slice(0, limit), total: p.length }
  return { rows: hit.rows.map((r) => ({ pkg: r.path.split('.')[0], name: r.name })), total: hit.total, all: p.length }
}
