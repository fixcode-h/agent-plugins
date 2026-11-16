import type { McpResult } from '../../../sdk/server.ts'
import { runOp, type OpCtx } from '../ops.ts'
import { out, str } from '../toolkit.ts'
import { runSnippet } from './run-snippet.ts'

/**
 * ue_lua 里 Lua 深度调试的几个 action（设计稿四.4）：snap 快照点、profile 性能采样、leaks 持有的已销毁 UObject，
 * 以及 exec 带 snippet 时按名字执行已批准的片段。ue_lua 只加一行分发到这里，免得和编译、改完能验几个包改同一段。
 * 桥接（UELink 2.4）没有这些操作时，桥接回的「不支持」原样给 Agent。
 */
export const DEBUG_ACTIONS = ['snap', 'profile', 'leaks'] as const

/** ue_lua 的参数里这几个 action 用到的（合进 ue_lua 的 properties） */
export const DEBUG_PROPS = {
  snippet: { type: 'string' },
  file: { type: 'string' },
  line: { type: 'number' },
  hits: { type: 'number' },
  id: { type: 'number' },
  remove: { type: 'boolean' },
  seconds: { type: 'number' },
}

/** 给 Agent 的结果再收一收：快照里的局部变量、采样的函数表可能很长，默认 4000 字以内（ADR 0067） */
const top = <T>(list: T[] | undefined, n: number) => (list ?? []).slice(0, n)

export async function debugAction(
  action: string,
  a: Record<string, unknown>,
  ctx: OpCtx,
): Promise<McpResult | undefined> {
  if (action === 'exec' && a.snippet !== undefined && !a.code) {
    const ms = Math.min(Math.max(Number(a.timeoutMs) || 5000, 100), 60000)
    return out(await runSnippet(ctx, str(a.snippet), ms))
  }
  if (action === 'snap') {
    if (a.remove) return out(await runOp(ctx, 'lua.snap', { action: 'remove', id: Number(a.id) || 0 }))
    if (a.file && a.line) {
      const hits = Math.min(Math.max(Number(a.hits) || 1, 1), 20)
      return out(await runOp(ctx, 'lua.snap', { action: 'add', file: str(a.file), line: Number(a.line), hits }))
    }
    const r = await runOp(ctx, 'lua.snap', { action: 'list', id: Number(a.id) || 0 })
    if (!a.id) return out(r)
    // 一次命中的局部变量可能很多：只给最近 3 次，每次前 30 个变量
    const items = (r.items as { captures?: { locals?: unknown[] }[] }[]) ?? []
    return out({
      ...r,
      items: items.map((s) => ({
        ...s,
        captures: (s.captures ?? []).slice(-3).map((cap) => ({ ...cap, locals: top(cap.locals, 30) })),
      })),
    })
  }
  if (action === 'profile') {
    const seconds = Math.min(Math.max(Number(a.seconds) || 5, 1), 60)
    await runOp(ctx, 'lua.profile', { action: 'start', seconds })
    // 采样是固定几秒、马上结束的事，等它完再一次回结果，Agent 不用再轮询
    await new Promise((r) => setTimeout(r, seconds * 1000 + 300))
    const r = await runOp(ctx, 'lua.profile', { action: 'result', limit: 30 })
    return out(r)
  }
  if (action === 'leaks') {
    const r = await runOp(ctx, 'lua.leaks', { limit: 40 }, 60000)
    return out(r)
  }
  return undefined
}
