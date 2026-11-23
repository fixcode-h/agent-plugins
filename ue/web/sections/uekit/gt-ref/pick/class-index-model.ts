import type { GtClassIndexResult, GtClassItem, GtClassRow } from '../../../../../shared/gt-script/index.ts'

/**
 * 「类」下拉本地索引的纯逻辑（不碰 React 和请求，单测和 class-index.ts 共用）：
 * 行 → 父子表、Lua 目录表、搜索用的小写名字；本地搜索；往上找祖先
 */

export interface LuaDir {
  /** 下一层子目录（/ 连的完整目录）和它下面（含更深层）的模块数 */
  subs: { name: string; count: number }[]
  mods: GtClassItem[]
}

export interface ClassIndex {
  v: string
  source: GtClassIndexResult['source']
  note?: string
  all: GtClassItem[]
  byName: Map<string, GtClassItem>
  /** 父类 → 直接子类（按名字排）；没有父类的挂在 '' 下 */
  kids: Map<string, GtClassItem[]>
  /** Lua：目录 → 子目录和正好在这个目录下的模块 */
  dirs: Map<string, LuaDir>
  /** 和 all 一一对应：整条名字、最后一段的小写（searchText 的两种比法预先算好，打字时不再每次 toLowerCase） */
  low: string[]
  leaf: string[]
}

const segs = (s: string) => s.replace(/\./g, '/').split('/').filter(Boolean)
/** Lua 模块所在目录（和 gt.classes 的 dir 一致） */
export const luaDirOf = (name: string) => segs(name).slice(0, -1).join('/')

/** 纯逻辑（单测用）：行 → 索引 */
export function buildIndex(
  rows: GtClassRow[],
  meta: Pick<ClassIndex, 'v' | 'source' | 'note'>,
  lua: boolean,
): ClassIndex {
  const kidCount = new Map<string, number>()
  for (const r of rows) if (r[1]) kidCount.set(r[1], (kidCount.get(r[1]) ?? 0) + 1)
  const all: GtClassItem[] = rows.map(([name, parent, kind, ref, live]) => ({
    name,
    ...(parent ? { parent } : {}),
    kind,
    ...(ref ? (kind === 'lua' ? { file: ref } : { asset: ref }) : {}),
    kids: kidCount.get(name) ?? 0,
    ...(live > 0 ? { live } : {}),
  }))
  all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const byName = new Map(all.map((x) => [x.name, x]))
  const kids = new Map<string, GtClassItem[]>()
  for (const it of all) {
    const p = it.parent && byName.has(it.parent) ? it.parent : ''
    const list = kids.get(p)
    if (list) list.push(it)
    else kids.set(p, [it])
  }
  const dirs = new Map<string, LuaDir>()
  const dirOf = (d: string) => {
    let x = dirs.get(d)
    if (!x) dirs.set(d, (x = { subs: [], mods: [] }))
    return x
  }
  if (lua) {
    const counts = new Map<string, Map<string, number>>()
    for (const it of all) {
      const parts = segs(it.name).slice(0, -1)
      dirOf(parts.join('/')).mods.push(it)
      for (let i = 0; i < parts.length; i++) {
        const up = parts.slice(0, i).join('/')
        const sub = parts.slice(0, i + 1).join('/')
        const m = counts.get(up) ?? new Map<string, number>()
        m.set(sub, (m.get(sub) ?? 0) + 1)
        counts.set(up, m)
      }
    }
    for (const [up, m] of counts)
      dirOf(up).subs = [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }))
  }
  const low = all.map((x) => x.name.toLowerCase())
  const leaf = low.map((s) => s.slice(Math.max(s.lastIndexOf('.'), s.lastIndexOf('/')) + 1))
  return { ...meta, all, byName, kids, dirs, low, leaf }
}

/** 搜到的最多列这么多（加上祖先），再多让用户多打几个字；虚拟滚动画得动，主要是别让一个字母就摊开上万行 */
export const SEARCH_MAX = 2000

/**
 * 本地搜：名字里含 q（不分大小写；Lua 只比最后一段，q 里带 . 或 / 时比整条，和 searchText 一致），
 * 空格分开的几个词都要含。完全一样的最前，开头对上的其次。返回命中的名字（最多 SEARCH_MAX 个）和总数
 */
export function searchIndex(ix: ClassIndex, q: string, keep?: (it: GtClassItem) => boolean) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return { hits: [] as GtClassItem[], total: 0 }
  const whole = words.some((w) => /[./]/.test(w))
  const hay = whole ? ix.low : ix.leaf
  const exact: GtClassItem[] = []
  const first: GtClassItem[] = []
  const rest: GtClassItem[] = []
  for (let i = 0; i < hay.length; i++) {
    const s = hay[i]
    let ok = true
    for (const w of words)
      if (!s.includes(w)) {
        ok = false
        break
      }
    if (!ok) continue
    const it = ix.all[i]
    if (keep && !keep(it)) continue
    // 名字和搜的一模一样的放最前（搜 BP_Hero 时它不该排在 BP_Hero_Old 后面）
    if (s === words[0] && words.length === 1) exact.push(it)
    else (s.startsWith(words[0]) ? first : rest).push(it)
  }
  const total = exact.length + first.length + rest.length
  return { hits: [...exact, ...first, ...rest].slice(0, SEARCH_MAX), total }
}

/** 一个类往上的祖先（不含自己），遇到 stop 停；防环 */
export function ancestors(ix: ClassIndex, name: string, stop?: string) {
  const out: string[] = []
  const seen = new Set<string>([name])
  for (let cur = ix.byName.get(name)?.parent; cur && !seen.has(cur); cur = ix.byName.get(cur)?.parent) {
    seen.add(cur)
    out.push(cur)
    if (cur === stop) break
  }
  return out
}
