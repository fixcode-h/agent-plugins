import { BridgeError } from '../instances.ts'
import type { OpCtx } from '../ops.ts'
import type { TraceRes } from '../trace-query.ts'
import { t } from '../util.ts'
import {
  brief,
  cached,
  frameSpan,
  framesOf,
  laneIds,
  laneKind,
  median,
  pct,
  q,
  r2,
  rangeOf,
  threadsOf,
  unknownWhat,
  type LaneKind,
  type Q,
  type TimerRow,
} from './trace-common.ts'

/**
 * 帧内各线程耗时（设计稿 4.3 的 frame / threads / bound）：每帧游戏线程、渲染线程、RHI、GPU 各忙了多久，
 * 由此判断瓶颈线程、看各线程每帧平均。UELink 2.11 起桥接 framestats 一遍算完；旧桥接用 timing（时间轴的块）在面板里拼，
 * 只看前 120 秒、标 approx。
 */

export interface FrameStats {
  /** 第一帧的帧号 */
  f0: number
  ms: number[]
  lanes: { id: number; name: string; kind: LaneKind; busy: number[] }[]
  /** 旧桥接的兜底：只算了前面一段、短块没算进去 */
  approx?: boolean
}

/** 兜底最多算多少秒：timing 要把每个块传回来，太长的 trace 会很慢 */
const FALLBACK_SECONDS = 120

async function fallbackStats(ctx: OpCtx, id: string): Promise<FrameStats> {
  const f = await framesOf(ctx, id)
  const threads = await threadsOf(ctx, id)
  const lanes = threads.filter((x) => laneKind(x.name, x.id) !== 'other')
  const end = Math.min(f.start.length, f.start.findIndex((s) => s > (f.start[0] ?? 0) + FALLBACK_SECONDS) >>> 0)
  const n = end > 0 ? end : f.start.length
  const busy = lanes.map(() => new Array<number>(n).fill(0))
  const t0 = f.start[0] ?? 0
  const t1 = n ? f.start[n - 1] + f.ms[n - 1] / 1000 : 0
  // 两秒一窗：timing 一次最多回两万块，窗口小一点不会被截
  for (let a = t0; a < t1; a += 2) {
    const res = (await q(ctx, id, {
      what: 'timing',
      t0: a,
      t1: Math.min(t1, a + 2),
      px: 4000,
      lanes: lanes.map((x) => x.id),
    })) as TraceRes & { lanes: { id: number; s: number[]; ms: number[]; d: number[] }[] }
    for (const l of res.lanes) {
      const li = lanes.findIndex((x) => x.id === l.id)
      if (li < 0) continue
      for (let i = 0; i < l.s.length; i++) {
        if (l.d[i] !== 0) continue
        const s = l.s[i]
        const e = s + l.ms[i] / 1000
        // 跨窗口的块只算落在这个窗口里的部分，免得算两遍
        const cs = Math.max(s, a)
        const ce = Math.min(e, a + 2)
        let k = 0
        while (k < n && f.start[k] + f.ms[k] / 1000 <= cs) k++
        for (; k < n && f.start[k] < ce; k++) {
          const ov = Math.min(ce, f.start[k] + f.ms[k] / 1000) - Math.max(cs, f.start[k])
          if (ov > 0) busy[li][k] += ov * 1000
        }
      }
    }
  }
  return {
    f0: 0,
    ms: f.ms.slice(0, n),
    lanes: lanes.map((x, i) => ({ id: x.id, name: x.name, kind: laneKind(x.name, x.id), busy: busy[i].map(r2) })),
    approx: true,
  }
}

export async function frameStatsOf(ctx: OpCtx, id: string): Promise<FrameStats> {
  return cached(ctx, id, 'framestats', async () => {
    try {
      const r = (await q(ctx, id, { what: 'framestats' })) as TraceRes & {
        f0: number
        ms: number[]
        lanes: { id: number; name: string; busy: number[] }[]
      }
      return {
        f0: r.f0 ?? 0,
        ms: r.ms,
        lanes: r.lanes.map((l) => ({ ...l, kind: laneKind(l.name, l.id) })),
      }
    } catch (e) {
      if (!unknownWhat(e)) throw e
      return fallbackStats(ctx, id)
    }
  })
}

/** 一帧的瓶颈：四类线程里最忙的；最忙的都不到帧时间的六成，说明在等（垂直同步、限帧、等 GPU 交换） */
export function boundOf(fs: FrameStats, i: number): LaneKind | 'wait' {
  const frame = fs.ms[i] ?? 0
  let best: LaneKind | 'wait' = 'wait'
  let max = 0
  for (const l of fs.lanes) {
    if (l.kind === 'other') continue
    // 同一类有几条线程（几个渲染线程）时取最忙的那条
    const b = l.busy[i] ?? 0
    if (b > max) {
      max = b
      best = l.kind
    }
  }
  return frame > 0 && max < frame * 0.6 ? 'wait' : best
}

/** 某类瓶颈对应的线程 id；wait（谁都不满）时不限 */
export const boundLanes = (fs: FrameStats, kind: LaneKind | 'wait') =>
  kind === 'wait' || kind === 'other' ? undefined : fs.lanes.filter((l) => l.kind === kind).map((l) => l.id)

/** 帧号范围（相对 framestats 的 f0）裁剪 */
const spanIn = (fs: FrameStats, a: number, b: number): [number, number] => [
  Math.max(0, a - fs.f0),
  Math.min(fs.ms.length, b - fs.f0),
]

export function boundSummary(fs: FrameStats, a = fs.f0, b = fs.f0 + fs.ms.length) {
  const [x, y] = spanIn(fs, a, b)
  const counts: Record<string, number> = {}
  const runs: { bound: string; from: number; to: number; frames: number }[] = []
  let cur: { bound: string; from: number; to: number; frames: number } | undefined
  for (let i = x; i < y; i++) {
    const k = boundOf(fs, i)
    counts[k] = (counts[k] ?? 0) + 1
    if (cur && cur.bound === k) {
      cur.to = i + fs.f0
      cur.frames++
    } else {
      cur = { bound: k, from: i + fs.f0, to: i + fs.f0, frames: 1 }
      runs.push(cur)
    }
  }
  const total = Math.max(1, y - x)
  const share = Object.fromEntries(
    Object.entries(counts)
      .sort((p, q2) => q2[1] - p[1])
      .map(([k, v]) => [k, r2(v / total)]),
  )
  return {
    frames: y - x,
    share,
    // 连续 30 帧以上同一个瓶颈的段，最长的几段（「第 300 到 420 帧都是 GPU 瓶颈」）
    runs: runs
      .filter((r) => r.frames >= 30)
      .sort((p, q2) => q2.frames - p.frames)
      .slice(0, 6),
    ...(fs.approx ? { approx: true } : {}),
  }
}

export function threadSummary(fs: FrameStats, a = fs.f0, b = fs.f0 + fs.ms.length) {
  const [x, y] = spanIn(fs, a, b)
  const frameAvg = fs.ms.slice(x, y).reduce((s, v) => s + v, 0) / Math.max(1, y - x)
  return fs.lanes
    .map((l) => {
      const xs = l.busy.slice(x, y)
      const sorted = [...xs].sort((p, q2) => p - q2)
      const avg = xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length)
      let worst = 0
      for (let i = 1; i < xs.length; i++) if (xs[i] > xs[worst]) worst = i
      return {
        lane: l.id,
        name: l.name,
        kind: l.kind,
        avgMs: r2(avg),
        p95Ms: r2(pct(sorted, 0.95)),
        maxMs: r2(sorted.at(-1) ?? 0),
        share: frameAvg ? r2(avg / frameAvg) : 0,
        worstFrame: x + worst + fs.f0,
      }
    })
    .sort((p, q2) => q2.avgMs - p.avgMs)
}

/** what=threads：各线程统计（每帧平均、P95、占帧时间比例、最忙的那帧） */
export async function threadsQuery(ctx: OpCtx, id: string, qy: Q) {
  const fs = await frameStatsOf(ctx, id)
  const f = await framesOf(ctx, id)
  const [a, b] = frameSpan(f, await rangeOf(ctx, id, qy))
  return {
    frames: b - a,
    threads: threadSummary(fs, a, b),
    all: (await threadsOf(ctx, id)).length,
    ...(fs.approx
      ? { approx: true, note: t('分析用的 UELink 低于 2.11，只算了前 120 秒、短块没算进去；升级 UELink 后更准') }
      : {}),
    next: 'timers lane=<线程名> perFrame=true 看那条线程上的热点',
  }
}

/** what=bound：每帧瓶颈分布和连续段 */
export async function boundQuery(ctx: OpCtx, id: string, qy: Q) {
  const fs = await frameStatsOf(ctx, id)
  const f = await framesOf(ctx, id)
  const [a, b] = frameSpan(f, await rangeOf(ctx, id, qy))
  return {
    ...boundSummary(fs, a, b),
    note: 'game / render / rhi / gpu 是那一帧最忙的线程；wait 是最忙的线程也不到帧时间的六成（垂直同步、限帧或互相等待）',
    next: 'threads 看各线程每帧平均；frames=<起-止> 限定某一段后再 timers lane=<瓶颈线程>',
  }
}

interface DiffItem {
  id: number
  name: string
  excl: number
  base: number
  gpu?: boolean
  file?: string
  line?: number
  c?: boolean
}
export interface FrameDiff {
  frame: number
  start: number
  ms: number
  items: DiffItem[]
}

/**
 * 一组帧和基线（中位附近的普通帧）比，每帧独占时间涨得最多的计时器。
 * 新桥接一次算完；旧桥接逐帧查 timers，和整段的每帧平均比（只算前 maxFallback 帧）
 */
export async function frameDiffs(
  ctx: OpCtx,
  id: string,
  frames: number[],
  top = 8,
  maxFallback = 10,
  /** 只比这些线程（卡顿帧的瓶颈线程）：别的线程涨了不影响这一帧的长短，混进来会把元凶带偏 */
  lanes?: number[],
) {
  const only = lanes?.length ? { lanes } : {}
  if (!frames.length) return { base: { frames: 0, ms: 0 }, frames: [] as FrameDiff[] }
  try {
    const r = (await q(ctx, id, { what: 'framediff', frames, top, ...only })) as TraceRes & {
      base: { frames: number; ms: number }
      frames: FrameDiff[]
    }
    return { base: r.base, frames: r.frames }
  } catch (e) {
    if (!unknownWhat(e)) throw e
  }
  const f = await framesOf(ctx, id)
  const all = (await q(ctx, id, { what: 'timers', top: 400, ...only })) as TraceRes & { items: TimerRow[] }
  const n = Math.max(1, f.ms.length)
  const avg = new Map(all.items.map((x) => [x.id, x.excl / n]))
  const out: FrameDiff[] = []
  for (const fr of frames.slice(0, maxFallback)) {
    const t0 = f.start[fr]
    const t1 = t0 + f.ms[fr] / 1000
    const r = (await q(ctx, id, { what: 'timers', t0, t1, top: 60, ...only })) as TraceRes & { items: TimerRow[] }
    out.push({
      frame: fr,
      start: t0,
      ms: f.ms[fr],
      items: r.items
        .map((x) => ({ ...x, base: r2(avg.get(x.id) ?? 0) }))
        .filter((x) => x.excl - x.base > 0)
        .sort((x, y) => y.excl - y.base - (x.excl - x.base))
        .slice(0, top)
        .map((x) => ({
          id: x.id,
          name: x.name,
          excl: x.excl,
          base: x.base,
          gpu: x.gpu,
          file: x.file,
          line: x.line,
          c: x.c,
        })),
    })
  }
  return { base: { frames: f.ms.length, ms: r2(median(f.ms)) }, frames: out, approx: true }
}

export const diffItem = (x: DiffItem) => ({
  name: x.name,
  extraMs: r2(x.excl - x.base),
  ms: r2(x.excl),
  ...(x.gpu ? { gpu: true } : {}),
  ...(x.file && !x.c ? { src: x.line ? `${x.file}:${x.line}` : x.file } : {}),
  ...(x.c ? { c: true } : {}),
})

/** what=frame：一帧的全貌——各线程忙多久、瓶颈、涨得最多的计时器、各线程独占最多的计时器、附近的日志和书签 */
export async function frameQuery(ctx: OpCtx, id: string, qy: Q) {
  const f = await framesOf(ctx, id)
  const fr = Number(qy.frame)
  if (!(fr >= 0 && fr < f.start.length))
    throw new BridgeError(t('要给 frame（帧号，0 到 {n}）', { n: Math.max(0, f.start.length - 1) }))
  const t0 = f.start[fr]
  const t1 = t0 + f.ms[fr] / 1000
  const fs = await frameStatsOf(ctx, id)
  const i = fr - fs.f0
  const inStats = i >= 0 && i < fs.ms.length
  const diff = await frameDiffs(ctx, id, [fr], 8, 1, inStats ? boundLanes(fs, boundOf(fs, i)) : undefined)
  const want = (await laneIds(ctx, id, qy.lane)) ?? fs.lanes.filter((l) => l.kind !== 'other').map((l) => l.id)
  const lanes = []
  for (const lane of want.slice(0, 6)) {
    const r = (await q(ctx, id, { what: 'timers', t0, t1, lanes: [lane], top: 5 })) as TraceRes & {
      items: TimerRow[]
    }
    const st = fs.lanes.find((l) => l.id === lane)
    lanes.push({
      lane,
      name: st?.name ?? String(lane),
      busyMs: inStats && st ? st.busy[i] : undefined,
      top: r.items.map(brief).map(({ id: tid, name, exclMs, inclMs, count, src }) => ({
        id: tid,
        name,
        exclMs,
        inclMs,
        count,
        src,
      })),
    })
  }
  const log = (await q(ctx, id, { what: 'log', t0: t0 - 1, t1: t1 + 1, top: 200 })) as TraceRes & {
    items: { t: number; v: string; c: string; m: string }[]
  }
  const marks = ((await q(ctx, id, { what: 'bookmarks' })).items as { t: number; text: string }[]).filter(
    (m) => m.t >= t0 - 1 && m.t <= t1 + 1,
  )
  return {
    frame: fr,
    at: r2(t0),
    ms: f.ms[fr],
    medianMs: r2(median(f.ms)),
    ...(inStats ? { bound: boundOf(fs, i) } : {}),
    grew: diff.frames[0]?.items.map(diffItem) ?? [],
    lanes,
    log: log.items
      .filter((x) => /Warning|Error|Fatal/i.test(x.v))
      .slice(0, 10)
      .map((x) => ({ at: r2(x.t), v: x.v, category: x.c, message: x.m.slice(0, 300) })),
    bookmarks: marks.map((m) => ({ at: r2(m.t), name: m.text })),
    next: 'grew 里的计时器用 butterfly timer=<名字> 看谁调的；stack lane=<线程> time=<秒> 看那一刻的调用堆栈',
  }
}
