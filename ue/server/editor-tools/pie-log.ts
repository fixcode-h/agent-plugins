import { logTail } from '../actions.ts'
import type { OpCtx } from '../ops.ts'

/**
 * 「这次 PIE 之后的日志」（复盘 2026-11-25 A7）：Agent 用 ue_log 查新功能的报错时，errors 从 14 涨到 335，全是项目别处的老错误，
 * 看不出哪条是这次 PIE 新出的。pie_start 开 PIE 前记下日志游标（按项目记，带编辑器进程号，编辑器重开了就不认），
 * ue_log 加 pie=true 时从这个游标往后取；pie_start 的返回里也给出游标
 */
const marks = new Map<string, { pid: number; cursor: number }>()

/** 开 PIE 前记下当前日志游标；取不到（旧桥接、编辑器正忙）返回 undefined，不挡开 PIE */
export async function markPieLog(ctx: OpCtx, pid: number): Promise<number | undefined> {
  try {
    const r = await logTail({ ...ctx, target: { instance: 'editor' } }, { since: 0, limit: 1 })
    const cursor = Number(r.cursor)
    if (!Number.isFinite(cursor) || cursor <= 0) return undefined
    marks.set(ctx.project.root, { pid, cursor })
    return cursor
  } catch {
    return undefined
  }
}

/** ue_log pie=true：最近一次 pie_start 记下的游标；编辑器换了进程或还没用 pie_start 开过时说清怎么办 */
export function pieLogSince(root: string, pid: number | undefined): { since: number } | { error: string } {
  const m = marks.get(root)
  if (!m) return { error: '还没用 ue_editor action=pie_start 开过 PIE（面板只记它开 PIE 时的日志位置）：先 pie_start，或用上次结果里的 cursor 当 since' }
  if (pid !== undefined && m.pid !== pid)
    return { error: '编辑器重开过，之前记的 PIE 日志位置作废：重新 pie_start 后再用 pie=true' }
  return { since: m.cursor }
}
