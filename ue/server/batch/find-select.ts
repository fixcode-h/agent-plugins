import type { OpCtx } from '../ops.ts'
import { pageOf } from './select-filter.ts'
import { selectPaths } from './targets.ts'

/**
 * ue_find kind=asset 带 select：只按条件列出资源路径、不做任何操作（写法和批量的 select 一样，通配符、父类、多个目录、标签都认）。
 * Agent 想「先找出有哪些」时常误调 ue_asset action=select，那里的报错指到这里。
 * 选中多少都先取全（select 不限个数），回包按 offset / limit 分页，保证不超过 ADR 0067 的 4000 字
 */

export async function findBySelect(a: Record<string, unknown>, ctx: OpCtx) {
  const paths = await selectPaths(a.select as Record<string, unknown>, ctx)
  return pageOf(paths, a.offset, a.limit)
}
