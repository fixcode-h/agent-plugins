import { BridgeError } from '../instances.ts'
import { runOp, type OpCtx } from '../ops.ts'

/** 一批最多多少个资源（和 UELink 的 MaxBatchItems 一致） */
export const MAX_ITEMS = 2000

/** 工具参数里有没有批量写法：paths、items 或 select */
export const isBatch = (a: Record<string, unknown>) =>
  Array.isArray(a.paths) || Array.isArray(a.items) || !!a.retry || (!!a.select && typeof a.select === 'object')

export type Targets = { paths: string[] } | { items: Record<string, unknown>[] }

/**
 * 解析成 UELink 认的 paths / items：select 先按条件在资源注册表里搜（目录、类、名字前缀、父类、标签），
 * 超过上限直接报错（不悄悄截断，免得 Agent 以为全改了）
 */
export async function resolveTargets(a: Record<string, unknown>, ctx: OpCtx): Promise<Targets> {
  if (Array.isArray(a.items)) return check({ items: a.items as Record<string, unknown>[] }, a.items.length)
  if (Array.isArray(a.paths)) return check({ paths: a.paths.map(String) }, a.paths.length)
  const s = a.select as Record<string, unknown>
  // 关卡里的 Actor：按类、标签、名字前缀在世界里找（UELink 2.14 的 actors 筛选）
  if (s.kind === 'actor') {
    const res = await runOp(ctx, 'actors', {
      class: s.class,
      tag: s.tag,
      prefix: s.prefix ?? '',
      world: s.world,
      limit: MAX_ITEMS,
    })
    if (res.more) throw new BridgeError(`select 选中的 Actor 超过 ${MAX_ITEMS} 个：加 class / tag / prefix 缩小范围`)
    const actors = ((res.items as { path?: string }[]) ?? []).map((x) => String(x.path ?? '')).filter(Boolean)
    if (!actors.length) throw new BridgeError('select 没有选中任何 Actor：检查 class、tag、prefix 和 world')
    return { paths: actors }
  }
  const res = await runOp(ctx, 'assets', {
    path: s.path || '/Game',
    class: s.class,
    prefix: s.prefix,
    parent: s.parent,
    tags: s.tags,
    recursive: s.recursive,
    limit: MAX_ITEMS,
  })
  const total = Number(res.total ?? 0)
  if (total > MAX_ITEMS)
    throw new BridgeError(
      `select 选中了 ${total} 个资源，一批最多 ${MAX_ITEMS} 个：缩小目录、加 class / prefix / parent，或分几批`,
    )
  const paths = ((res.items as { path?: string }[]) ?? []).map((x) => String(x.path ?? '')).filter(Boolean)
  if (!paths.length) throw new BridgeError('select 没有选中任何资源：检查 path、class、prefix、parent')
  return { paths }
}

function check(t: Targets, n: number) {
  if (!n) throw new BridgeError('paths / items 是空的')
  if (n > MAX_ITEMS) throw new BridgeError(`一批最多 ${MAX_ITEMS} 个资源，给了 ${n} 个：分几批调`)
  return t
}
