import type { GmFav, GmStore } from './schema.ts'

/**
 * 常用（gm.json 的 common，用户 2026-11-22：四个分类的收藏合成一份、可以分组）。GM 页左栏「常用」、概览「常用」、
 * 控制台页的星标、双击 Shift 跳转都读这一份。一条是条目键 + 那组参数 + 分组：同一条 GM 可以放几组不同的参数。
 * 这里只做纯数据变换，网页和服务端（ue_gm remove 清引用）共用
 */
type G = Pick<GmStore, 'common' | 'commonGroups'>

export const consoleKey = (cmd: string) => `console:${cmd}`
export const macroKey = (id: string) => `macro:${id}`
export const objKey = (name: string) => `obj:${name}`

const emptyArgs = (a: GmFav['args']) => !a || (Array.isArray(a) ? !a.some((x) => x !== '') : !Object.keys(a).length)
const norm = (a: GmFav['args']) => (emptyArgs(a) ? null : a)
const sameArgs = (a: GmFav['args'], b: GmFav['args']) => JSON.stringify(norm(a)) === JSON.stringify(norm(b))

/** 同一条（键和参数都一样，分组不算） */
export const commonIndex = (g: G, f: Pick<GmFav, 'key' | 'args'>) =>
  g.common.findIndex((x) => x.key === f.key && sameArgs(x.args, f.args))
export const inCommon = (g: G, f: Pick<GmFav, 'key' | 'args'>) => commonIndex(g, f) >= 0

/** 加到常用 / 移出：有就去掉，没有加到末尾（空参数不存 args；group 是放进哪个分组） */
export function toggleCommon<T extends G>(g: T, f: Pick<GmFav, 'key' | 'args'>, group?: string): T {
  const i = commonIndex(g, f)
  if (i >= 0) return { ...g, common: g.common.filter((_, k) => k !== i) }
  const item: GmFav = { key: f.key, ...(emptyArgs(f.args) ? {} : { args: f.args }), ...(group ? { group } : {}) }
  return { ...g, common: [...g.common, item] }
}

/** 去掉某个键的所有条目（GM、宏、对象删掉时清引用） */
export const dropCommon = <T extends G>(g: T, keys: Iterable<string>): T => {
  const gone = new Set(keys)
  return { ...g, common: g.common.filter((x) => !gone.has(x.key)) }
}

/** 改键（对象、宏改名时跟着改） */
export const renameCommonKey = <T extends G>(g: T, from: string, to: string): T => ({
  ...g,
  common: g.common.map((x) => (x.key === from ? { ...x, key: to } : x)),
})

/** 拖动：把第 from 条挪到第 to 条的位置，并放进 group（拖进分组 / 拖到最外层） */
export function moveCommon<T extends G>(g: T, from: number, to: number, group?: string): T {
  const list = [...g.common]
  const [x] = list.splice(from, 1)
  if (!x) return g
  const moved: GmFav = { key: x.key, ...(x.args ? { args: x.args } : {}), ...(group ? { group } : {}) }
  list.splice(Math.max(0, Math.min(list.length, to)), 0, moved)
  return { ...g, common: list }
}

/** 把一条放进分组（group 空 = 最外层） */
export const setCommonGroup = <T extends G>(g: T, i: number, group?: string): T => moveCommon(g, i, i, group)

/** 所有分组：存的空分组 + 条目用到的（含上层），排好序 */
export function commonGroups(g: G): string[] {
  const all = new Set<string>()
  const add = (p: string) => {
    const segs = p.split('/').filter(Boolean)
    for (let i = 1; i <= segs.length; i++) all.add(segs.slice(0, i).join('/'))
  }
  for (const p of g.commonGroups) add(p)
  for (const x of g.common) if (x.group) add(x.group)
  return [...all].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

const under = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`)

/** 新建分组（已有就不动） */
export function addCommonGroup<T extends G>(g: T, path: string): T {
  const p = path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/')
  if (!p || commonGroups(g).includes(p)) return g
  return { ...g, commonGroups: [...g.commonGroups, p] }
}

/** 分组改名（连同下面的子分组和条目） */
export function renameCommonGroup<T extends G>(g: T, from: string, to: string): T {
  const re = (p: string) => (under(p, from) ? to + p.slice(from.length) : p)
  return {
    ...g,
    commonGroups: g.commonGroups.map(re),
    common: g.common.map((x) => (x.group && under(x.group, from) ? { ...x, group: re(x.group) } : x)),
  }
}

/** 删分组：里面的条目挪到它的上一层（不删条目，误删了也找得回来） */
export function deleteCommonGroup<T extends G>(g: T, path: string): T {
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  return {
    ...g,
    commonGroups: g.commonGroups.filter((p) => !under(p, path)),
    common: g.common.map((x) => {
      if (!x.group || !under(x.group, path)) return x
      const { group: _g, ...rest } = x
      return parent ? { ...rest, group: parent } : rest
    }),
  }
}

/** 控制台页的星标命令 */
export const consoleFavs = (g: Pick<GmStore, 'common'> | undefined) =>
  (g?.common ?? []).filter((f) => f.key.startsWith('console:')).map((f) => f.key.slice(8))

/** 参数的显示：按顺序的写成空格隔开，按名字的只写值 */
export const argsText = (a: GmFav['args']) =>
  !a
    ? ''
    : (Array.isArray(a)
        ? a
        : Object.values(a).map((v) =>
            v && typeof v === 'object' && '$obj' in v
              ? String((v as { $obj: unknown }).$obj)
              : typeof v === 'string'
                ? v
                : JSON.stringify(v),
          )
      )
        .filter((x) => x !== '')
        .join(' ')
