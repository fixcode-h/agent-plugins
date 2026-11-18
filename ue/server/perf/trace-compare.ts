import { getCapture } from '../captures.ts'
import type { OpCtx } from '../ops.ts'
import type { TraceRes } from '../trace-query.ts'
import { frameSpan, framesOf, frameStats, q, r2, rangeOf, timeArgs, type Q, type TimerRow } from './trace-common.ts'
import { boundSummary, frameStatsOf, threadSummary } from './trace-frames.ts'
import { hitchReport } from './trace-hitches.ts'

/**
 * 两份 trace 对比（设计稿 4.6，改前改后复测）：两份录的时长、帧数不一定一样，所以都换成「每帧平均」再比；
 * 各线程、瓶颈分布、卡顿元凶、计时器（每帧平均独占时间涨跌最多的）。from / to 写书签名时两份各按自己的书签取范围。
 */

async function side(ctx: OpCtx, id: string, qy: Q) {
  const f = await framesOf(ctx, id)
  const r = await rangeOf(ctx, id, qy)
  const [a, b] = frameSpan(f, r)
  const n = Math.max(1, b - a)
  const fs = await frameStatsOf(ctx, id)
  const timers = (await q(ctx, id, { what: 'timers', ...timeArgs(r), top: 300 })) as TraceRes & { items: TimerRow[] }
  const hitches = await hitchReport(ctx, id, { ...qy, thresholdMs: qy.thresholdMs }, 30)
  const cap = await getCapture(ctx.project, id)
  return {
    cap,
    n,
    stats: frameStats({ ms: f.ms.slice(a, b) }),
    bound: boundSummary(fs, a, b).share,
    threads: threadSummary(fs, a, b).filter((x) => x.kind !== 'other'),
    timers: new Map(timers.items.map((x) => [x.name, { per: x.excl / n, gpu: x.gpu }])),
    hitches,
  }
}

export async function traceCompare(ctx: OpCtx, id: string, other: string, qy: Q) {
  const A = await side(ctx, id, qy)
  const B = await side(ctx, other, qy)
  const d = (x: number, y: number) => r2(y - x)
  const warnings: string[] = []
  if (A.cap.preset && B.cap.preset && A.cap.preset !== B.cap.preset)
    warnings.push(`两份的录制预设不同（${A.cap.preset} / ${B.cap.preset}），开销不同，绝对值不完全可比`)
  if (!!A.cap.lua !== !!B.cap.lua) warnings.push('一份录了 Lua、一份没录：录 Lua 会让 Lua 变慢，Lua 相关的数字不可比')
  if (Math.abs(A.n - B.n) / Math.max(A.n, B.n) > 0.5)
    warnings.push(`两份的帧数差得多（${A.n} / ${B.n}），场景可能不一样；用 from / to 书签对齐同一段`)
  const names = new Set([...A.timers.keys(), ...B.timers.keys()])
  const rows = [...names].map((name) => {
    const x = A.timers.get(name)?.per ?? 0
    const y = B.timers.get(name)?.per ?? 0
    return {
      name,
      before: r2(x),
      after: r2(y),
      deltaMs: r2(y - x),
      ...(A.timers.get(name)?.gpu || B.timers.get(name)?.gpu ? { gpu: true } : {}),
    }
  })
  const top = Math.min(Math.max(1, Number(qy.top) || 12), 50)
  const worse = rows
    .filter((r) => r.deltaMs > 0.01)
    .sort((x, y) => y.deltaMs - x.deltaMs)
    .slice(0, top)
  const better = rows
    .filter((r) => r.deltaMs < -0.01)
    .sort((x, y) => x.deltaMs - y.deltaMs)
    .slice(0, top)
  const threads = A.threads.map((t) => {
    const o = B.threads.find((x) => x.name === t.name)
    return { name: t.name, before: t.avgMs, after: o?.avgMs, deltaMs: o ? d(t.avgMs, o.avgMs) : undefined }
  })
  const groups = new Set([...A.hitches.groups.map((g) => g.culprit), ...B.hitches.groups.map((g) => g.culprit)])
  return {
    before: { id: A.cap.id, label: A.cap.label, frames: A.n },
    after: { id: B.cap.id, label: B.cap.label, frames: B.n },
    frames: {
      avgMs: [A.stats.avgMs, B.stats.avgMs, d(A.stats.avgMs, B.stats.avgMs)],
      p50Ms: [A.stats.p50Ms, B.stats.p50Ms, d(A.stats.p50Ms, B.stats.p50Ms)],
      p95Ms: [A.stats.p95Ms, B.stats.p95Ms, d(A.stats.p95Ms, B.stats.p95Ms)],
      p99Ms: [A.stats.p99Ms, B.stats.p99Ms, d(A.stats.p99Ms, B.stats.p99Ms)],
      fps: [A.stats.fps, B.stats.fps, d(A.stats.fps, B.stats.fps)],
      low1Fps: [A.stats.low1Fps, B.stats.low1Fps, d(A.stats.low1Fps, B.stats.low1Fps)],
      hitches: [A.hitches.count, B.hitches.count, B.hitches.count - A.hitches.count],
    },
    bound: { before: A.bound, after: B.bound },
    threads,
    hitchGroups: [...groups].map((g) => ({
      culprit: g,
      before: A.hitches.groups.find((x) => x.culprit === g)?.hitches ?? 0,
      after: B.hitches.groups.find((x) => x.culprit === g)?.hitches ?? 0,
    })),
    worse,
    better,
    ...(warnings.length ? { warnings } : {}),
    note: '数组是 [前, 后, 差]；计时器按每帧平均独占毫秒比（录制时长不同也能比），deltaMs > 0 是变慢',
  }
}
