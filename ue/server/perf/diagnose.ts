import type { OpCtx } from '../ops.ts'
import type { TraceRes } from '../trace-query.ts'
import { culpritOf, culpritRules } from './culprits.ts'
import {
  brief,
  frameSpan,
  framesOf,
  frameStats,
  q,
  r2,
  rangeOf,
  timeArgs,
  unknownWhat,
  type Q,
  type TimerRow,
} from './trace-common.ts'
import { boundSummary, frameStatsOf, threadSummary } from './trace-frames.ts'
import { hitchReport } from './trace-hitches.ts'

/**
 * 一次调用给出「这份 trace 有什么问题」（设计稿 4.5）：整体帧率和瓶颈、卡顿按元凶分组、各线程的热点、内存和日志的异常，
 * 每条发现按对帧时间的影响（摊到每帧的毫秒，impactMs）排序，并给出可以并行深挖的方向（focus），
 * ue-perf 角色据此 spawn_agents 派 ue-perf-drill 子任务。
 */

/** 像内存的计数器：名字里有 Memory、Alloc、Bytes、Objects，或以 KB / MB 结尾（Lua/FrameMs 这种不能算） */
const MEM_COUNTER = /memory|alloc|bytes|objects?\b|(^|[/_ ])mem([/_ ]|$)|kb$|mb$/i

type Focus = 'game' | 'render' | 'hitch' | 'lua' | 'memory' | 'loading'

interface Finding {
  kind: string
  title: string
  impactMs: number
  detail?: unknown
  focus?: Focus
  next?: string
}

/** session（2.11）：录了哪些数据；旧桥接上只知道有没有 Lua */
async function sessionHas(ctx: OpCtx, id: string): Promise<Record<string, boolean>> {
  try {
    const s = (await q(ctx, id, { what: 'session' })) as TraceRes & { has: Record<string, boolean> }
    return s.has ?? {}
  } catch (e) {
    if (!unknownWhat(e)) throw e
    const info = await q(ctx, id, { what: 'info' })
    return { cpu: true, lua: !!info.lua }
  }
}

export async function diagnose(ctx: OpCtx, id: string, qy: Q) {
  const f = await framesOf(ctx, id)
  const range = await rangeOf(ctx, id, qy)
  const [a, b] = frameSpan(f, range)
  const n = Math.max(1, b - a)
  const stats = frameStats({ ms: f.ms.slice(a, b) })
  const has = await sessionHas(ctx, id)
  const fs = await frameStatsOf(ctx, id)
  const bound = boundSummary(fs, a, b)
  const threads = threadSummary(fs, a, b).filter((x) => x.kind !== 'other')
  const hitches = await hitchReport(ctx, id, qy, 40)
  const rules = await culpritRules(ctx.project)
  const findings: Finding[] = []

  // 1. 稳态：最忙的线程每帧平均多少，超过目标帧时间（默认 16.67ms）的部分算影响
  const target = Number(qy.targetMs) || 16.67
  const top = threads[0]
  const mainBound = Object.entries(bound.share).sort((x, y) => y[1] - x[1])[0]
  if (top && stats.p50Ms > target) {
    const focus: Focus = top.kind === 'gpu' || top.kind === 'render' || top.kind === 'rhi' ? 'render' : 'game'
    findings.push({
      kind: 'steady',
      title: `中位帧 ${stats.p50Ms}ms 超过目标 ${target}ms，最忙的是 ${top.name}（每帧平均 ${top.avgMs}ms）`,
      impactMs: r2(stats.p50Ms - target),
      detail: { bound: mainBound ? { [mainBound[0]]: mainBound[1] } : undefined, thread: top },
      focus,
      next: `timers lane=${top.name} perFrame=true`,
    })
  }

  // 2. 卡顿：每类元凶一条
  for (const g of hitches.groups.slice(0, 6)) {
    findings.push({
      kind: 'hitch',
      title: `${g.culprit}：${g.hitches} 次卡顿，共多出 ${g.extraMs}ms`,
      impactMs: g.impactMs,
      detail: { frames: g.frames.slice(0, 6), top: g.top },
      focus:
        g.culprit === 'Lua'
          ? 'lua'
          : g.culprit === '同步加载' || g.culprit === '关卡流送'
            ? 'loading'
            : g.culprit === '垃圾回收'
              ? 'memory'
              : 'hitch',
      next: g.hint ?? `frame=${g.frames[0]}`,
    })
  }
  if (hitches.periodic)
    findings.push({
      kind: 'periodic',
      title: `卡顿大约每 ${hitches.periodic.everySeconds} 秒一次（很规律）：多半是定时器、周期 GC 或定时存档`,
      impactMs: 0,
      focus: 'hitch',
      next: 'hitches 看 groups 里是哪类',
    })

  // 3. 热点计时器：整段独占时间最多的，按类归一下（同一类的放一起说）
  // 只看最忙的那条线程：工作线程上的时间不直接算进帧时间，混进来会排到前面误导
  const hotLanes =
    top && top.kind !== 'other' ? fs.lanes.filter((l) => l.kind === top.kind).map((l) => l.id) : undefined
  const timers = (await q(ctx, id, {
    what: 'timers',
    ...timeArgs(range),
    top: 25,
    ...(hotLanes ? { lanes: hotLanes } : {}),
  })) as TraceRes & {
    items: TimerRow[]
  }
  const hot = timers.items
    .filter((x) => !x.gpu || top?.kind === 'gpu')
    .slice(0, 10)
    .map((x) => ({ ...brief(x), perFrameMs: r2(x.excl / n), culprit: culpritOf(rules, x.name)?.name }))
  if (hot[0] && hot[0].perFrameMs >= 1)
    findings.push({
      kind: 'hot',
      title: `${top?.name ?? ''} 上独占时间最多的是 ${hot[0].name}（每帧平均 ${hot[0].perFrameMs}ms）`,
      impactMs: hot[0].perFrameMs,
      detail: hot.slice(0, 5).map(({ name, perFrameMs, culprit }) => ({ name, perFrameMs, culprit })),
      focus: hot[0].src ? 'lua' : 'game',
      next: `butterfly timer=${hot[0].name}`,
    })

  // 4. Lua：录了 Lua 时给 Lua 的总占比
  if (has.lua) {
    const lua = (await q(ctx, id, {
      what: 'timers',
      ...timeArgs(range),
      lua: true,
      mergeC: true,
      top: 5,
    })) as TraceRes & {
      items: TimerRow[]
    }
    const sum = lua.items.reduce((s, x) => s + x.excl, 0)
    if (lua.items.length)
      findings.push({
        kind: 'lua',
        title: `Lua 前 5 个函数每帧共 ${r2(sum / n)}ms，最多的是 ${lua.items[0].name}`,
        impactMs: r2(sum / n),
        detail: lua.items.map(brief).map(({ name, exclMs, src }) => ({ name, exclMs, src })),
        focus: 'lua',
        next: 'tree luaOnly=true',
      })
  }

  // 5. 内存：计数器里一直涨的（2.11 起有统计）；memtags 有数据时看涨得最多的标签
  const memory: unknown[] = []
  try {
    const cs = (await q(ctx, id, { what: 'counters', stats: true, ...timeArgs(range) })) as TraceRes & {
      counters: { name: string; first?: number; last?: number; max?: number }[]
    }
    for (const c of cs.counters)
      if (MEM_COUNTER.test(c.name) && c.first !== undefined && c.last !== undefined) {
        const g = c.last - c.first
        if (g > 0 && c.first > 0 && g / c.first > 0.05)
          memory.push({ counter: c.name, first: r2(c.first), last: r2(c.last), growth: r2(g) })
      }
  } catch (e) {
    if (!unknownWhat(e)) throw e
  }
  if (has.memtags) {
    try {
      const m = (await q(ctx, id, { what: 'memtags', ...timeArgs(range) })) as TraceRes & {
        items: { name: string; firstKB: number; lastKB: number; peakKB: number }[]
      }
      for (const x of [...m.items].sort((p, r) => r.lastKB - r.firstKB - (p.lastKB - p.firstKB)).slice(0, 5))
        if (x.lastKB - x.firstKB > 1024)
          memory.push({ tag: x.name, firstKB: x.firstKB, lastKB: x.lastKB, growthKB: r2(x.lastKB - x.firstKB) })
    } catch {
      // memtags 拿不到不影响别的结论
    }
  }
  if (memory.length)
    findings.push({
      kind: 'memory',
      title: `录制期间有 ${memory.length} 项内存读数一直在涨`,
      impactMs: 0,
      detail: memory.slice(0, 8),
      focus: 'memory',
      next: has.allocs
        ? 'allocs groupBy=callstack'
        : 'counters sort=growth；要看是谁分配的，UE 用 -trace=memory 启动后录 preset=memory',
    })

  // 6. 日志里的错误和警告
  const log = (await q(ctx, id, { what: 'log', ...timeArgs(range), top: 2000 })) as TraceRes & {
    items: { t: number; v: string; c: string; m: string }[]
  }
  const bad = log.items.filter((x) => /Error|Fatal|Warning/.test(x.v))
  const byCat = new Map<string, number>()
  for (const x of bad) byCat.set(`${x.v} ${x.c}`, (byCat.get(`${x.v} ${x.c}`) ?? 0) + 1)
  if (bad.length)
    findings.push({
      kind: 'log',
      title: `日志里有 ${bad.length} 条警告 / 错误`,
      impactMs: 0,
      detail: [...byCat.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 6)
        .map(([k, v]) => ({ kind: k, count: v })),
      next: 'log verbosity=Warning',
    })

  if (has.loads)
    findings.push({ kind: 'data', title: '录到了加载数据', impactMs: 0, focus: 'loading', next: 'loads sort=time' })

  findings.sort((x, y) => y.impactMs - x.impactMs)
  // 可以并行深挖的方向：每个 focus 一个子任务，带上这一方向要先看的发现
  const focuses = new Map<Focus, string[]>()
  for (const x of findings) if (x.focus) focuses.set(x.focus, [...(focuses.get(x.focus) ?? []), x.title])
  return {
    frames: { ...stats, hitches: hitches.count, hitchThresholdMs: hitches.thresholdMs },
    bound: bound.share,
    threads: threads.slice(0, 5).map(({ name, avgMs, p95Ms, share }) => ({ name, avgMs, p95Ms, share })),
    recorded: Object.keys(has).filter((k) => has[k]),
    findings: findings.slice(0, 12),
    drill: [...focuses.entries()].map(([focus, why]) => ({ focus, why: why.slice(0, 3) })),
    ...(bound.approx ? { approx: true } : {}),
    note: 'impactMs 是这条问题摊到每帧的毫秒数，越大越该先看；drill 是可以并行深挖的方向（ue-perf-drill 的 focus 参数）',
  }
}
