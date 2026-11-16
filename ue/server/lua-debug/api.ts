import type { OpCtx } from '../ops.ts'
import { runSnippet } from './run-snippet.ts'
import { editSnippets, listSnippets } from './snippets.ts'

/**
 * Lua 深度调试的网页接口（挂在 /api/plugins/ue/p/<项目>/lua/… 下）：片段的列、改、批准、执行。
 * 快照点、采样、持有的 UObject 网页直接走 POST op（lua.snap / lua.profile / lua.leaks），不用另开接口。
 * 不是这里的路由返回 undefined，交给下一个
 */
export async function luaDebugRoute(ctx: OpCtx, route: string, b: Record<string, unknown>) {
  switch (route) {
    case 'GET lua/snippets':
      return listSnippets(ctx.project)
    case 'POST lua/snippets':
      return editSnippets(ctx.project, b)
    case 'POST lua/snippets/run':
      return runSnippet(ctx, String(b.name ?? ''), Math.min(Math.max(Number(b.timeoutMs) || 10000, 100), 60000))
    default:
      return undefined
  }
}
