import type { OpCtx } from '../ops.ts'
import { culpritOf, culpritRules } from './culprits.ts'
import {
  frameSpan,
  framesOf,
  frameStats,
  median,
  page,
  r2,
  rangeOf,
  type Frames,
  type LaneKind,
  type Q,
} from './trace-common.ts'
import { boundLanes, boundOf, diffItem, frameDiffs, frameStatsOf, type FrameDiff } from './trace-frames.ts'

/**
 * 帧列表和卡顿（设计稿 4.3 的 frames / hitches）：
 * frames 给统计和最慢的帧；hitches 再往前一步——找出卡顿帧、合并成簇、看是不是周期性的，
 * 并且和普通帧比，算出每次卡顿多出来的时间花在哪个计时器上，按「元凶」分类（culprits.ts）汇总。
 */

/** 默认卡顿门槛：中位帧的两倍，且不低于 33.3 毫秒（30 帧） */
export const hitchThreshold = (f: Pick<Frames, 'ms'>, qy: Q) => {
  const given = Number(qy.thresholdMs)
  return given > 0 ? given : r2(Math.max(33.3, median(f.ms) * 2))
}

/** what=frames：帧统计和最慢的帧（type=render 看渲染帧） */
export async function framesQuery(ctx: OpCtx, id: string, qy: Q) {
  const type = qy.type === 'render' ? 'render' : undefined
  const f = await framesOf(ctx, id, type)
  const [a, b] = frameSpan(f, await rangeOf(ctx, id, qy))
  const thr = Number(qy.thresholdMs) || 0
  const list = []
  for (let i = a; i < b; i++) if (f.ms[i] >= thr) list.push({ frame: i, at: r2(f.start[i]), ms: f.ms[i] })
  list.sort((x, y) => y.ms - x.ms)
  return {
    ...(type ? { type } : {}),
    stats: frameStats({ ms: f.ms.slice(a, b) }),
    ...(a > 0 || b < f.ms.length ? { range: { fromFrame: a, toFrame: b - 1 } } : {}),
    worst: page(list, qy, 20),
    next: 'frame=<帧号> 看一帧的全貌；hitches 看卡顿归因；bound 看瓶颈线程',
  }
}

interface Hitch {
  frame: number
  at: number
  ms: number
}

/** 相邻卡顿（间隔不到 5 帧）并成一簇：连着卡几帧的是一次事件 */
function clusters(list: Hitch[]) {
  const out: { from: number; to: number; at: number; frames: number; totalMs: number; maxMs: number }[] = []
  for (const h of [...list].sort((a, b) => a.frame - b.frame)) {
    const last = out.at(-1)
    if (last && h.frame - last.to <= 5) {
      last.to = h.frame
      last.frames++
      last.totalMs = r2(last.totalMs + h.ms)
      last.maxMs = Math.max(last.maxMs, h.ms)
    } else out.push({ from: h.frame, to: h.frame, at: h.at, frames: 1, totalMs: h.ms, maxMs: h.ms })
  }
  return out
}

/** 簇之间的间隔很均匀（变异系数 < 0.2，至少 4 簇）时报周期：定时器、周期 GC、定时存档常见 */
function periodOf(cs: { at: number }[]) {
  if (cs.length < 4) return undefined
  const gaps = cs.slice(1).map((x, i) => x.at - cs[i].at)
  const avg = gaps.reduce((s, x) => s + x, 0) / gaps.length
  const sd = Math.sqrt(gaps.reduce((s, x) => s + (x - avg) ** 2, 0) / gaps.length)
  return avg > 0 && sd / avg < 0.2 ? { everySeconds: r2(avg), jitter: r2(sd / avg) } : undefined
}

export interface HitchReport {
  thresholdMs: number
  medianMs: number
  frames: number
  count: number
  /** 卡顿帧比中位帧多出来的时间加起来，摊到每帧（毫秒）：衡量对整体帧时间的影响 */
  impactMs: number
  clusters: ReturnType<typeof clusters>
  periodic?: { everySeconds: number; jitter: number }
  groups: {
    culprit: string
    hitches: number
    extraMs: number
    impactMs: number
    frames: number[]
    top: string[]
    hint?: string
  }[]
  items: (Hitch & { bound?: string; culprit?: string; grew?: ReturnType<typeof diffItem>[] })[]
  attributed: number
  approx?: boolean
}

/** 找卡顿并归因；diagnose 也用它。attribute 是最多归因几帧（按最慢的先） */
export async function hitchReport(ctx: OpCtx, id: string, qy: Q, attribute = 40): Promise<HitchReport> {
  const f = await framesOf(ctx, id)
  const [a, b] = frameSpan(f, await rangeOf(ctx, id, qy))
  const thr = hitchThreshold(f, qy)
  const med = median(f.ms.slice(a, b))
  const list: Hitch[] = []
  for (let i = a; i < b; i++) if (f.ms[i] >= thr) list.push({ frame: i, at: r2(f.start[i]), ms: f.ms[i] })
  const worst = [...list].sort((x, y) => y.ms - x.ms)
  // 按每帧的瓶颈线程分组归因：游戏线程卡的帧只看游戏线程上涨了什么
  const fs = await frameStatsOf(ctx, id).catch(() => undefined)
  const boundAt = (fr: number) =>
    fs && fr - fs.f0 >= 0 && fr - fs.f0 < fs.ms.length ? boundOf(fs, fr - fs.f0) : undefined
  const groupsByBound = new Map<string, number[]>()
  for (const h of worst.slice(0, attribute)) {
    const k = boundAt(h.frame) ?? 'wait'
    groupsByBound.set(k, [...(groupsByBound.get(k) ?? []), h.frame])
  }
  const diffs: FrameDiff[] = []
  let approx = false
  for (const [k, frs] of groupsByBound) {
    const d = await frameDiffs(ctx, id, frs, 8, 10, fs ? boundLanes(fs, k as LaneKind | 'wait') : undefined)
    diffs.push(...d.frames)
    approx ||= !!d.approx
  }
  const diff = { frames: diffs, approx }
  const byFrame = new Map(diff.frames.map((x) => [x.frame, x]))
  const rules = await culpritRules(ctx.project)
  const groups = new Map<string, HitchReport['groups'][number] & { names: Map<string, number> }>()
  const items: HitchReport['items'] = worst.map((h) => {
    const d = byFrame.get(h.frame)
    const grew = d?.items.map(diffItem) ?? []
    // 元凶：涨得最多、且对得上分类的那几项里涨得最多的类；都对不上时用涨得最多的计时器名
    const score = new Map<string, number>()
    let hint: string | undefined
    for (const g of grew) {
      // Lua 函数（带源码位置）先归 Lua；UE 接口的 C 函数（UE.LoadObject 这类）先按名字归，对不上再归 Lua
      const k = g.src ? 'Lua' : (culpritOf(rules, g.name)?.name ?? (g.c ? 'Lua' : g.name))
      score.set(k, (score.get(k) ?? 0) + g.extraMs)
    }
    const culprit = [...score.entries()].sort((x, y) => y[1] - x[1])[0]?.[0]
    if (culprit) {
      hint = rules.find((r) => r.name === culprit)?.hint
      const e =
        groups.get(culprit) ??
        groups
          .set(culprit, {
            culprit,
            hitches: 0,
            extraMs: 0,
            impactMs: 0,
            frames: [],
            top: [],
            names: new Map(),
            ...(hint ? { hint } : {}),
          })
          .get(culprit)!
      e.hitches++
      e.extraMs = r2(e.extraMs + Math.max(0, h.ms - med))
      e.frames.push(h.frame)
      for (const g of grew) e.names.set(g.name, (e.names.get(g.name) ?? 0) + g.extraMs)
    }
    const i = fs ? h.frame - fs.f0 : -1
    return {
      ...h,
      ...(fs && i >= 0 && i < fs.ms.length ? { bound: boundOf(fs, i) } : {}),
      ...(d ? { culprit, grew: grew.slice(0, 4) } : {}),
    }
  })
  const n = Math.max(1, b - a)
  const cs = clusters(list)
  return {
    thresholdMs: thr,
    medianMs: r2(med),
    frames: b - a,
    count: list.length,
    impactMs: r2(list.reduce((s, x) => s + Math.max(0, x.ms - med), 0) / n),
    clusters: cs,
    periodic: periodOf(cs),
    groups: [...groups.values()]
      .map(({ names, ...g }) => ({
        ...g,
        impactMs: r2(g.extraMs / n),
        frames: g.frames.slice(0, 12),
        top: [...names.entries()]
          .sort((x, y) => y[1] - x[1])
          .slice(0, 4)
          .map(([k]) => k),
      }))
      .sort((x, y) => y.extraMs - x.extraMs),
    items,
    attributed: diff.frames.length,
    ...(diff.approx ? { approx: true } : {}),
  }
}

/** what=hitches */
export async function hitchesQuery(ctx: OpCtx, id: string, qy: Q) {
  const r = await hitchReport(ctx, id, qy, Math.min(200, Number(qy.attribute) || 40))
  const { items, clusters: cs, ...rest } = r
  return {
    ...rest,
    clusters:
      cs.length > 12 ? { count: cs.length, longest: [...cs].sort((x, y) => y.totalMs - x.totalMs).slice(0, 12) } : cs,
    items: page(items, qy, 15),
    note: '时间毫秒；groups 按「元凶」分类汇总（extraMs 是这类卡顿比中位帧多出来的时间之和，impactMs 摊到每帧）；items 按最慢排，grew 是这帧比普通帧涨得最多的计时器',
    ...(r.attributed < r.count
      ? { attributedNote: `只给最慢的 ${r.attributed} 帧做了归因（attribute 调整，最多 200）` }
      : {}),
    next: 'frame=<帧号> 看某一帧全貌；butterfly timer=<grew 里的名字> 看是谁调的',
  }
}
