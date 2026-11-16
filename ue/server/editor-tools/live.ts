import { runOp, type OpCtx } from '../ops.ts'

/**
 * 配置、Tag 这类「UE 没开也能看个大概」的读取：有进程就问进程拿最终值，没有（或桥接旧、没这个操作）时
 * 不报错，回 error 让调用方退回读磁盘，并把原因带给网页和 Agent（不悄悄吞掉）。
 */
export async function tryOp<T>(ctx: OpCtx, op: string, args: Record<string, unknown>, timeoutMs = 15000) {
  try {
    return { data: (await runOp(ctx, op, args, timeoutMs)) as T & { instance?: { pid: number; kind: string } } }
  } catch (e) {
    return { error: (e as Error).message }
  }
}
