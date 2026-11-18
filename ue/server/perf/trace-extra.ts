import { getCapture } from '../captures.ts'
import { BridgeError } from '../instances.ts'
import type { OpCtx } from '../ops.ts'
import type { TraceRes } from '../trace-query.ts'
import { t } from '../util.ts'
import {
  bookmarksOf,
  flag,
  laneIds,
  needBridge,
  page,
  q,
  r2,
  rangeOf,
  threadsOf,
  timeArgs,
  unknownWhat,
  type Q,
} from './trace-common.ts'

/**
 * 不属于「帧和计时器」的那些数据（设计稿 4.3）：时间轴上的块、计数器、日志、书签、区间、内存、加载、文件、任务、
 * 线程切换、网络、截图、会话信息。大多是把桥接的结果翻页、裁短；桥接 2.11 才有的在旧桥接上提示升级。
 */

/** 2.11 起的查询：桥接不认识时提示升级（而不是原样报「不认识的查询」） */
async function q211(ctx: OpCtx, id: string, args: Q) {
  try {
    return await q(ctx, id, args)
  } catch (e) {
    if (unknownWhat(e)) throw needBridge(String(args.what))
    throw e
  }
}

const strip = ({ analyzing: _a, duration: _d, origin: _o, ...rest }: TraceRes & Q) => rest

/** what=events：一条线程在一段时间里的块（时间轴上看到的那些），按耗时倒序；name 按名字筛、minMs 只要够长的 */
export async function eventsQuery(ctx: OpCtx, id: string, qy: Q) {
  const r = await rangeOf(ctx, id, qy)
  if (r.t0 === undefined || r.t1 === undefined)
    throw new BridgeError(t('events 要限定范围：frame / frames 或 from + to（时间轴上的块很多，整份 trace 太大）'))
  if (r.t1 - r.t0 > 10) throw new BridgeError(t('events 的范围最多 10 秒，先用 hitches / frames 找到那一段'))
  const lanes = (await laneIds(ctx, id, qy.lane)) ?? (await laneIds(ctx, id, 'GameThread'))!
  const threads = await threadsOf(ctx, id)
  const res = (await q(ctx, id, { what: 'timing', ...timeArgs(r), px: 8000, lanes })) as TraceRes & {
    lanes: { id: number; s: number[]; ms: number[]; d: number[]; t: number[]; x?: number[] }[]
    names: Record<string, string>
    cut?: boolean
  }
  const name = String(qy.name ?? '').toLowerCase()
  const min = Number(qy.minMs) || 0
  const maxDepth = qy.depth === undefined || qy.depth === '' ? Infinity : Number(qy.depth)
  const all = res.lanes.flatMap((l) =>
    l.s.map((s, i) => ({
      lane: threads.find((x) => x.id === l.id)?.name ?? String(l.id),
      name: res.names[String(l.t[i])] ?? `#${l.t[i]}`,
      at: Math.round(s * 1e5) / 1e5,
      ms: l.ms[i],
      ...(l.x ? { exclMs: l.x[i] } : {}),
      depth: l.d[i],
    })),
  )
  const list = all
    .filter((e) => e.ms >= min && e.depth <= maxDepth && (!name || e.name.toLowerCase().includes(name)))
    .sort((a, b) => b.ms - a.ms)
  return {
    ...page(list, qy, 40),
    ...(res.cut ? { cut: true, cutNote: '桥接只回了一部分很短的块（太多了）；缩小范围或加 minMs' } : {}),
    note: '时间：at 是秒，ms 是毫秒；depth 0 是线程最外层；按耗时倒序。要看某一刻完整的调用链用 stack',
  }
}

interface CounterRow {
  name: string
  n?: number
  min?: number
  max?: number
  avg?: number
  first?: number
  last?: number
  firstT?: number
  lastT?: number
}

/** what=counters：不写 name 列出计数器（2.11 起带统计，sort=growth 按涨幅排，找泄漏）；写 name 给走势 */
export async function countersQuery(ctx: OpCtx, id: string, qy: Q) {
  const r = await rangeOf(ctx, id, qy)
  if (!qy.name || flag(qy.list)) {
    const res = (await q(ctx, id, { what: 'counters', stats: true, ...timeArgs(r) })) as TraceRes & {
      counters: CounterRow[]
    }
    const filter = String(qy.filter ?? qy.name ?? '').toLowerCase()
    let list = res.counters.filter((x) => !filter || x.name.toLowerCase().includes(filter))
    const hasStats = list.some((x) => x.n !== undefined)
    if (hasStats) {
      const growth = (x: CounterRow) => (x.last ?? 0) - (x.first ?? 0)
      const key = String(qy.sort ?? '')
      if (key === 'growth') list = [...list].sort((a, b) => growth(b) - growth(a))
      else if (key === 'max') list = [...list].sort((a, b) => (b.max ?? 0) - (a.max ?? 0))
      else if (key === 'avg') list = [...list].sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))
    }
    return {
      ...page(
        list.map((x) =>
          x.n === undefined
            ? { name: x.name }
            : {
                name: x.name,
                n: x.n,
                min: r2(x.min ?? 0),
                avg: r2(x.avg ?? 0),
                max: r2(x.max ?? 0),
                first: r2(x.first ?? 0),
                last: r2(x.last ?? 0),
                growth: r2((x.last ?? 0) - (x.first ?? 0)),
              },
        ),
        qy,
        40,
      ),
      ...(hasStats
        ? {
            note: 'growth = 范围内最后一个值 - 第一个值；内存类计数器一直涨且不回落要怀疑泄漏，接着 name=<计数器> 看走势',
          }
        : { note: '分析用的 UELink 低于 2.11，列表没有统计；name=<计数器> 看单条走势' }),
    }
  }
  const res = (await q(ctx, id, {
    what: 'counters',
    names: [String(qy.name)],
    ...timeArgs(r),
    px: Math.min(Math.max(10, Number(qy.points) || 60), 400),
  })) as TraceRes & {
    series: { name: string; t: number[]; v: number[] }[]
  }
  const s = res.series[0]
  if (!s) throw new BridgeError(t('没有叫「{name}」的计数器（不写 name 列出全部）', { name: String(qy.name) }))
  const vs = [...s.v].sort((a, b) => a - b)
  return {
    name: s.name,
    min: vs[0],
    max: vs.at(-1),
    first: s.v[0],
    last: s.v.at(-1),
    points: s.t.map((x, i) => [r2(x), s.v[i]]),
    note: 'points 是 [秒, 值]，每段取最大值（points 调段数，最多 400）',
  }
}

const LEVELS = ['Fatal', 'Error', 'Warning', 'Display', 'Log', 'Verbose', 'VeryVerbose']

/** what=log：verbosity 只要这一级及更严重的；near=<秒> 取那一刻前后 window 秒（默认 2） */
export async function logQuery(ctx: OpCtx, id: string, qy: Q) {
  let r = await rangeOf(ctx, id, qy)
  if (qy.near !== undefined && qy.near !== '') {
    const at = Number(qy.near)
    const w = Number(qy.window) || 2
    r = { t0: at - w, t1: at + w }
  }
  const level = LEVELS.findIndex((x) => x.toLowerCase() === String(qy.verbosity ?? '').toLowerCase())
  const res = (await q(ctx, id, {
    what: 'log',
    ...timeArgs(r),
    filter: qy.name ? String(qy.name) : undefined,
    top: 2000,
  })) as TraceRes & { items: { t: number; v: string; c: string; m: string }[]; total: number }
  const list = res.items
    .filter((x) => level < 0 || LEVELS.indexOf(x.v) <= level)
    .map((x) => ({ at: r2(x.t), v: x.v, category: x.c, message: x.m.slice(0, 400) }))
  // 同一句反复刷的日志先折叠：只留第一次和次数，免得一页全是同一句
  const seen = new Map<string, { at: number; v: string; category: string; message: string; times?: number }>()
  for (const x of list) {
    const k = `${x.v}|${x.category}|${x.message.replace(/\d+(\.\d+)?/g, '#')}`
    const hit = seen.get(k)
    if (hit) hit.times = (hit.times ?? 1) + 1
    else seen.set(k, { ...x })
  }
  return {
    totalInRange: res.total,
    ...page([...seen.values()], qy, 30),
    note: '同一句（数字不同也算）只留第一次，times 是出现次数；verbosity=Warning 只看警告和错误',
  }
}

/** what=bookmarks */
export async function bookmarksQuery(ctx: OpCtx, id: string, qy: Q) {
  const marks = await bookmarksOf(ctx, id)
  return page(
    marks.map((m) => ({ at: r2(m.t), name: m.text })),
    qy,
    50,
  )
}

/** 2.11 的查询原样转发（参数换算好、结果翻页）：regions / memtags / allocs / loads / files / tasks / switches / net / session */
export async function passQuery(ctx: OpCtx, id: string, what: string, qy: Q) {
  const r = await rangeOf(ctx, id, qy)
  const args: Q = { what, ...timeArgs(r) }
  for (const k of ['filter', 'sort', 'groupBy', 'tracker', 'depth', 'at', 'px'] as const)
    if (qy[k] !== undefined && qy[k] !== '') args[k] = qy[k]
  if (what === 'memtags' && qy.name) args.name = qy.name
  if (qy.top !== undefined) args.top = Math.min(200, Number(qy.top) || 30)
  if (what === 'switches') {
    const lanes = await laneIds(ctx, id, qy.lane)
    if (lanes) args.lanes = lanes
  }
  const res = strip(await q211(ctx, id, args))
  const items = res.items as unknown[] | undefined
  // 有 items 的翻页，其他字段原样；带走势的 memtags 不翻（一般只有一项）
  if (Array.isArray(items) && !(what === 'memtags' && qy.name)) {
    const { items: _i, ...rest } = res
    return { ...rest, ...page(items, qy, 30) }
  }
  return res
}

/** what=screenshots：录制时 ue_perf action=mark shot=true 截的图；what=screenshot 给某一张的路径（图用读文件看） */
export async function screenshotsQuery(ctx: OpCtx, id: string, qy: Q, one: boolean) {
  const cap = await getCapture(ctx.project, id)
  const shots = (cap.marks ?? [])
    .filter((m) => m.shot)
    .map((m, i) => ({ index: i, at: m.at, name: m.name, file: m.shot! }))
  if (!one)
    return {
      ...page(shots, qy, 50),
      ...(shots.length
        ? {}
        : { note: '这份 trace 没有截图：录制时用 ue_perf action=mark name=… shot=true 打书签并截图' }),
    }
  const i = Number(qy.index ?? qy.frame)
  const hit = Number.isFinite(i) ? shots[i] : shots.find((s) => s.name === String(qy.name ?? ''))
  if (!hit) throw new BridgeError(t('没有这张截图：先用 what=screenshots 看有哪些（index 或 name）'))
  return { ...hit, note: '用读文件工具打开 file 看图' }
}
