import type { GmCat, GmFav, GmStore } from './schema.ts'

/**
 * 收藏（gm.json 的 favs，每个分类一份，规格第 6 节）：GM 页左栏最下面、概览「常用」、控制台页的星标、双击 Shift 跳转都读这一份。
 * 一条是条目键 + 那组参数：`lua:<名>` / `cpp:<类>.<函数>` / `custom:<id>`（gm）、`cpp:…` / `console:<命令>`（engine）、
 * `macro:<id>`（macro）、`obj:<对象名>`（objcall）。同一条 GM 可以收藏几组不同的参数
 */
export const consoleKey = (cmd: string) => `console:${cmd}`

const sameArgs = (a: GmFav['args'], b: GmFav['args']) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
const emptyArgs = (a: GmFav['args']) => !a || (Array.isArray(a) ? !a.some((x) => x !== '') : !Object.keys(a).length)

export const favIndex = (g: Pick<GmStore, 'favs'>, cat: GmCat, f: GmFav) =>
  g.favs[cat].findIndex(
    (x) => x.key === f.key && sameArgs(emptyArgs(x.args) ? undefined : x.args, emptyArgs(f.args) ? undefined : f.args),
  )

export const hasFav = (g: Pick<GmStore, 'favs'>, cat: GmCat, f: GmFav) => favIndex(g, cat, f) >= 0

/** 收藏 / 取消：有就去掉，没有加到末尾（空参数不存 args） */
export function toggleFav<T extends Pick<GmStore, 'favs'>>(g: T, cat: GmCat, f: GmFav): T {
  const i = favIndex(g, cat, f)
  const list = g.favs[cat]
  const next = i >= 0 ? list.filter((_, k) => k !== i) : [...list, emptyArgs(f.args) ? { key: f.key } : f]
  return { ...g, favs: { ...g.favs, [cat]: next } }
}

/** 换位置（左栏收藏拖动 / 上移下移） */
export function moveFav<T extends Pick<GmStore, 'favs'>>(g: T, cat: GmCat, from: number, to: number): T {
  const list = [...g.favs[cat]]
  const [x] = list.splice(from, 1)
  if (!x) return g
  list.splice(Math.max(0, Math.min(list.length, to)), 0, x)
  return { ...g, favs: { ...g.favs, [cat]: list } }
}

/** 控制台页的收藏命令 */
export const consoleFavs = (g: Pick<GmStore, 'favs'> | undefined) =>
  (g?.favs.engine ?? []).filter((f) => f.key.startsWith('console:')).map((f) => f.key.slice(8))

/** 收藏里参数的显示：按顺序的写成空格隔开，按名字的只写值 */
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
