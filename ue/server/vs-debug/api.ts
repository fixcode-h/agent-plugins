import type { OpCtx } from '../ops.ts'
import { t } from '../util.ts'
import { vsCall } from './connect.ts'
import { openVs } from './open-vs.ts'
import { isKnownOp } from './protocol.ts'

/**
 * UE 页「VS 调试」卡片的接口（挂在 /api/plugins/ue/p/<项目>/vs-debug… 下）：
 * - POST vs-debug        {op, args} → {result} 或 {error}：原样转发给 VS（不在协议里的 op 拒绝）
 * - POST vs-debug/open-vs           → {ok, opened} 或 {error}：打开 VS 并等调试控制就绪（最多 3 分钟）
 * 你在网页上点的按钮就是你自己的操作，stop / restart 不再弹确认（Agent 的工具才走确认卡片）。
 * 错误放在 200 的 {error} 里给卡片原样显示，不是这里的路由返回 undefined 交给下一个
 */
export async function vsDebugRoute(ctx: OpCtx, route: string, b: Record<string, unknown>) {
  switch (route) {
    case 'POST vs-debug': {
      const op = String(b.op ?? '')
      if (!isKnownOp(op)) return { error: t('VS 调试没有这个操作：{op}', { op: op || '（空）' }) }
      const args =
        b.args && typeof b.args === 'object' && !Array.isArray(b.args) ? (b.args as Record<string, unknown>) : {}
      return vsCall(ctx.project, op, args).then(
        (result) => ({ result }),
        (e: Error) => ({ error: e.message }),
      )
    }
    case 'POST vs-debug/open-vs':
      return openVs(ctx.project).then(
        (r) => ({ ok: true, opened: r.opened }),
        (e: Error) => ({ error: e.message }),
      )
    default:
      return undefined
  }
}
