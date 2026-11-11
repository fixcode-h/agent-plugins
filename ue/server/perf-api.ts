import { captureCompare, captureList, captureQuery, captureSummary, deleteCapture, importCapture } from './captures.ts'
import type { OpCtx } from './ops.ts'
import { captureStatus, markCapture, startCapture, stopCapture } from './perf.ts'
import { renameCapture, revealCapture } from './perf-files.ts'
import { liveRead } from './perf-live.ts'
import { openInInsights, traceQuery } from './trace-query.ts'

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
    case 'POST perf/live':
      // 读数的轮询很频繁：只读、不进操作记录（runOp 对只读操作本来就不记）
      return liveRead(ctx, Number(b.since) || 0, Number(b.limit) || 600)
    case 'POST perf/start':
      return startCapture(ctx, {
        kind: s(b.kind),
        // 网页传 0（不限时长）；Agent 那边没给时按默认
        seconds: b.seconds,
        label: s(b.label),
        preset: s(b.preset),
        channels: s(b.channels),
        named: b.named === true,
      })
    case 'POST perf/stop':
      return stopCapture(ctx, s(b.id) || undefined)
    case 'POST perf/mark':
      return markCapture(ctx, s(b.name))
    case 'POST perf/trace': {
      // 时间轴、计时器、调用树等都按范围来这里查；网页拖动缩放很频繁，只读、不进操作记录
      const { id, ...args } = b
      return traceQuery(ctx, s(id), args)
    }
    case 'POST perf/insights':
      return openInInsights(p, s(b.id))
    case 'POST perf/summary':
      return captureSummary(p, s(b.id))
    case 'POST perf/query':
      return captureQuery(p, s(b.id), b)
    case 'POST perf/compare':
      return captureCompare(p, s(b.id), s(b.other), Number(b.top) || undefined)
    case 'POST perf/import':
      return importCapture(p, s(b.path), s(b.label) || undefined)
    case 'POST perf/reveal':
      return revealCapture(p, s(b.id))
    case 'POST perf/rename':
      return renameCapture(p, s(b.id), s(b.label))
    case 'POST perf/delete':
      return deleteCapture(p, s(b.id))
    default:
      return undefined
  }
}
