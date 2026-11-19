import { BridgeError } from '../instances.ts'
import { runOp, type OpCtx } from '../ops.ts'
import { keep, list, tooMany } from './select-filter.ts'
import { c } from '../util.ts'

/** 关卡 Actor 的 select 一次最多（UELink 的 actors 操作上限） */
export const MAX_ACTORS = 2000
/** 资源的 select 不限个数（用户 2026-11-19 定）：UELink 2.15 起 assets 的 limit=0 表示不截断 */
const NO_LIMIT = 0
/** UELink 2.14 及以前 assets 一次最多给的个数 */
const OLD_LIMIT = 2000

/** 工具参数里有没有批量写法：paths、items 或 select */
export const isBatch = (a: Record<string, unknown>) =>
  Array.isArray(a.paths) || Array.isArray(a.items) || !!a.retry || (!!a.select && typeof a.select === 'object')

export type Targets = { paths: string[] } | { items: Record<string, unknown>[] }

/**
 * 解析成 UELink 认的 paths / items：select 先按条件在资源注册表里搜（目录、类、父类、名字通配符、标签），不限个数；
 * paths / items 逐个列出的超过设置的上限时直接拦下（不执行），让 Agent 改用 select
 */
export async function resolveTargets(a: Record<string, unknown>, ctx: OpCtx): Promise<Targets> {
  if (Array.isArray(a.items)) return check({ items: a.items as Record<string, unknown>[] }, a.items.length, 'items')
  if (Array.isArray(a.paths)) return check({ paths: a.paths.map(String) }, a.paths.length, 'paths')
  const s = a.select as Record<string, unknown>
  // 关卡里的 Actor：按类、标签、名字前缀在世界里找（UELink 2.14 的 actors 筛选）
  if (s.kind === 'actor') {
    const res = await runOp(ctx, 'actors', {
      class: s.class,
      tag: s.tag,
      prefix: s.prefix ?? '',
      world: s.world,
      limit: MAX_ACTORS,
    })
    if (res.more) throw new BridgeError(`select 选中的 Actor 超过 ${MAX_ACTORS} 个：加 class / tag / prefix 缩小范围`)
    const actors = ((res.items as { path?: string }[]) ?? []).map((x) => String(x.path ?? '')).filter(Boolean)
    if (!actors.length) throw new BridgeError('select 没有选中任何 Actor：检查 class、tag、prefix 和 world')
    return { paths: actors }
  }
  // path 也可以直接给目录数组（等同 paths）
  const dirs = list(Array.isArray(s.path) ? s.path : s.paths)
  const name = list(s.name)
  const exclude = list(s.exclude)
  const query = (limit: number) =>
    runOp(ctx, 'assets', {
      path: typeof s.path === 'string' && s.path ? s.path : '/Game',
      // UELink 2.15 起认 paths / name / exclude；旧版忽略它们，下面在面板这边再筛一遍，结果一样
      ...(dirs.length && { paths: dirs }),
      ...(name.length && { name }),
      ...(exclude.length && { exclude }),
      class: s.class,
      prefix: s.prefix,
      parent: s.parent,
      tags: s.tags,
      recursive: s.recursive,
      limit,
    })
  let res = await query(NO_LIMIT)
  // 旧 UELink（2.14 及以前）把 limit=0 当成 1：选中的不超过它的上限时按上限再取一次
  if (((res.items as unknown[]) ?? []).length < Number(res.total ?? 0) && Number(res.total) <= OLD_LIMIT)
    res = await query(OLD_LIMIT)
  const total = Number(res.total ?? 0)
  const got = ((res.items as unknown[]) ?? []).length
  // 拿到的比选中的少时不能悄悄只改一部分
  if (got < total)
    throw new BridgeError(
      `select 选中了 ${total} 个资源，但这个 UELink 一次只给 ${got} 个：在 UE 页把 UELink 升级到 2.15 并本地编译后不限个数；现在先缩小目录、加 class / parent / name 分几批`,
    )
  const items = ((res.items as { path?: string; name?: string; package?: string }[]) ?? []).filter((x) =>
    keep(x, dirs, name, exclude),
  )
  const paths = items.map((x) => String(x.path ?? '')).filter(Boolean)
  if (!paths.length) throw new BridgeError('select 没有选中任何资源：检查 path、class、parent、name、exclude')
  return { paths }
}

function check(t: Targets, n: number, key: string) {
  if (!n) throw new BridgeError('paths / items 是空的')
  const why = tooMany(n, key, Number(c().config().batchListMax))
  if (why) throw new BridgeError(why)
  return t
}
