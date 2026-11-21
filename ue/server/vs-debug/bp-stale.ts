/**
 * 断点列表缓存什么时候作废。VS 运行中状态刷新只问 status、断点列表用上一次的（state.ts，怕把 VS 卡死），
 * 但刚增删改过断点（网页按钮或 Agent 的 ue_vs_breakpoints）时旧列表就是错的：用户点「清掉 Agent 下的」后
 * 总数已经是 0、列表还挂着两条，看起来像清不掉。所以改过断点的项目，下一次刷新不管忙不忙都重取一次列表
 */
const stale = new Set<string>()

/** 改断点的操作：除了 bp.list 的 bp.* */
export const changesBreakpoints = (op: string) => op.startsWith('bp.') && op !== 'bp.list'

export function markBreakpointsStale(projectId: string) {
  stale.add(projectId)
}

/** 取走作废标记：返回 true 表示这次要重取列表 */
export function takeBreakpointsStale(projectId: string) {
  return stale.delete(projectId)
}
