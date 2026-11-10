import {
  captureCompare,
  captureList,
  captureQuery,
  captureSummary,
  deleteCapture,
  importCapture,
} from './captures.ts'
import type { OpCtx } from './ops.ts'
import { captureStatus, markCapture, startCapture, stopCapture } from './perf.ts'

/**
 * 网页「性能」分区用的接口（挂在 /api/plugins/ue/p/<项目>/perf… 下）。和 Agent 的 ue_perf / ue_capture 走同一套函数，
 * 网页上的操作记成 actor=user，不受 Agent 权限限制；删除在网页上先弹确认。不认识的路径返回 undefined 交回 api.ts。
 */
export async function perfRoute(ctx: OpCtx, key: string, b: Record<string, unknown>): Promise<unknown> {
  const p = ctx.project
  const s = (v: unknown) => (v === undefined || v === null ? '' : String(v))
  switch (key) {
    case 'GET perf':
      return { ...(await captureList(p, undefined, 100)), ...(await captureStatus(ctx)) }
    case 'POST perf/start':
      return startCapture(ctx, { kind: s(b.kind), seconds: Number(b.seconds), label: s(b.label) })
    case 'POST perf/stop':
      return stopCapture(ctx, s(b.id) || undefined)
    case 'POST perf/mark':
      return markCapture(ctx, s(b.name))
    case 'POST perf/summary':
      return captureSummary(p, s(b.id))
    case 'POST perf/query':
      return captureQuery(p, s(b.id), b)
    case 'POST perf/compare':
      return captureCompare(p, s(b.id), s(b.other), Number(b.top) || undefined)
    case 'POST perf/import':
      return importCapture(p, s(b.path), s(b.label) || undefined)
    case 'POST perf/delete':
      return deleteCapture(p, s(b.id))
    default:
      return undefined
  }
}
