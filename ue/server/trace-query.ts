import { spawn } from 'node:child_process'
import path from 'node:path'
import { getCapture, type Capture } from './captures.ts'
import { ensureBackground } from './editor.ts'
import { BridgeError, liveCards, rpc, type Card } from './instances.ts'
import type { OpCtx } from './ops.ts'
import type { UeProject } from './types.ts'
import { c, exists, t } from './util.ts'

/**
 * trace 查询（性能页设计 3.2、二期）：.utrace 交给桥接编辑器模块里的 trace.query（UE 自己的 TraceServices）分析，
 * 这里只负责挑进程、转发、把结果裁成 Agent 读得动的大小。
 * 分析在编辑器开着时用编辑器，没开就用后台编辑器；游戏进程没有编辑器模块，也不该在被测的进程里分析。
 */
export const TRACE_BRIDGE = '1.5.0'

const newer = (v: string, min: string) => {
  const a = v.split('.').map((x) => parseInt(x, 10) || 0)
  const b = min.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}

async function analysisCard(p: UeProject): Promise<Card> {
  const cards = await liveCards(p.root)
  const card =
    cards.find((x) => x.kind === 'editor') ??
    cards.find((x) => x.kind === 'background') ??
    (c().config().offline === 'off' ? undefined : await ensureBackground(p))
  if (!card)
    throw new BridgeError(
      t('分析 trace 要用编辑器或后台编辑器，但插件参数里关掉了离线读取（后台编辑器）：先打开编辑器'),
    )
  if (!newer(card.bridge || '0', TRACE_BRIDGE))
    throw new BridgeError(
      t('{kind} 里的桥接是 {v}，分析 trace 要 {min} 以上：在「桥接与权限」里更新桥接插件，重新编译后再打开', {
        kind: card.kind === 'editor' ? t('编辑器') : t('后台编辑器'),
        v: card.bridge || '?',
        min: TRACE_BRIDGE,
      }),
    )
  return card
}

export interface TraceRes extends Record<string, unknown> {
  analyzing: boolean
  duration: number
}

async function traceCapture(p: UeProject, id: string): Promise<Capture> {
  const cap = await getCapture(p, id)
  if (cap.kind !== 'trace') throw new BridgeError(t('{id} 不是 trace（.utrace）', { id }))
  return cap
}

/** 网页和 Agent 共用：what 见桥接 AgentPanelTrace.cpp（info / frames / timing / timers / butterfly / stack / counters / log / bookmarks） */
export async function traceQuery(ctx: OpCtx, id: string, args: Record<string, unknown>): Promise<TraceRes> {
  const cap = await traceCapture(ctx.project, id)
  const card = await analysisCard(ctx.project)
  try {
    const { ok: _ok, ...res } = await rpc(card, 'trace.query', { ...args, file: cap.file }, 60000)
    return res as TraceRes
  } catch (e) {
    const msg = (e as Error).message
    if (/trace\.query/.test(msg))
      throw new BridgeError(t('这个进程的桥接还没有 trace 分析：更新桥接插件到 {min} 以上', { min: TRACE_BRIDGE }))
    throw e
  }
}

// ---------- 给 Agent 的摘要和下钻（结果限长，不把整份 trace 塞进上下文） ----------

interface Frames {
  start: number[]
  ms: number[]
  total: number
}
interface TimerRow {
  id: number
  name: string
  count: number
  incl: number
  inclMax: number
  excl: number
  gpu?: boolean
}

const pct = (sorted: number[], q: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0
const r2 = (n: number) => Math.round(n * 100) / 100

function frameStats(f: Frames) {
  const sorted = [...f.ms].sort((a, b) => a - b)
  const avg = f.ms.reduce((s, x) => s + x, 0) / Math.max(1, f.ms.length)
  return {
    count: f.total,
    avgMs: r2(avg),
    p95Ms: r2(pct(sorted, 0.95)),
    maxMs: r2(sorted.at(-1) ?? 0),
    fps: avg ? r2(1000 / avg) : 0,
  }
}

function worstFrames(f: Frames, top: number) {
  return f.ms
    .map((ms, i) => ({ frame: i, at: r2(f.start[i] ?? 0), ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, top)
}

const ANALYZING = (res: TraceRes) => ({
  analyzing: true,
  analyzedSeconds: r2(res.duration),
  next: t('还在分析（已经分析到第 {s} 秒），过几秒再查', { s: r2(res.duration) }),
})

export async function traceSummary(ctx: OpCtx, id: string) {
  const info = await traceQuery(ctx, id, { what: 'info' })
  if (info.analyzing) return ANALYZING(info)
  const frames = (await traceQuery(ctx, id, { what: 'frames' })) as TraceRes & Frames
  const timers = (await traceQuery(ctx, id, { what: 'timers', top: 15 })) as TraceRes & { items: TimerRow[] }
  const marks = (await traceQuery(ctx, id, { what: 'bookmarks' })) as TraceRes & {
    items: { t: number; text: string }[]
  }
  const threads = (info.threads as { id: number; name: string; group: string }[]) ?? []
  return {
    seconds: r2(info.duration),
    frames: frameStats(frames),
    worstFrames: worstFrames(frames, 8),
    threads: threads.slice(0, 30).map((x) => ({ lane: x.id, name: x.name, group: x.group || undefined })),
    topTimers: timers.items.map(brief),
    bookmarks: marks.items.slice(0, 30).map((m) => ({ at: r2(m.t), name: m.text })),
    next: 'query what=timers（from/to 或 frame 限定范围）→ what=butterfly timer=<名字或 id> 看调用者 / 被调用者 → what=stack lane=<泳道> time=<秒> 看那一刻的调用堆栈',
  }
}

const brief = (x: TimerRow) => ({
  id: x.id,
  name: x.name,
  count: x.count,
  inclMs: x.incl,
  exclMs: x.excl,
  maxMs: x.inclMax,
  ...(x.gpu ? { gpu: true } : {}),
})

/** from / to：秒数，或书签名；frame：只看这一帧 */
async function rangeOf(ctx: OpCtx, id: string, q: Record<string, unknown>) {
  if (q.frame !== undefined && q.frame !== '') {
    const f = (await traceQuery(ctx, id, { what: 'frames' })) as TraceRes & Frames
    const i = Number(q.frame)
    if (!(i >= 0 && i < f.start.length))
      throw new BridgeError(t('没有第 {i} 帧（共 {n} 帧）', { i: String(q.frame), n: f.start.length }))
    return { t0: f.start[i], t1: f.start[i] + f.ms[i] / 1000 }
  }
  let marks: { t: number; text: string }[] | undefined
  const at = async (v: unknown) => {
    if (v === undefined || v === null || v === '') return undefined
    const n = Number(v)
    if (Number.isFinite(n)) return n
    marks ??= (
      (await traceQuery(ctx, id, { what: 'bookmarks' })) as TraceRes & { items: { t: number; text: string }[] }
    ).items
    const name = String(v).toLowerCase()
    const hit =
      marks.find((m) => m.text.toLowerCase() === name) ?? marks.find((m) => m.text.toLowerCase().includes(name))
    if (!hit)
      throw new BridgeError(
        t('from / to 要写秒数或书签的名字，这份 trace 里没有叫「{name}」的书签', { name: String(v) }),
      )
    return hit.t
  }
  return { t0: await at(q.from), t1: await at(q.to) }
}

const clean = (o: { t0?: number; t1?: number }) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as { t0?: number; t1?: number }

/** 计时器可以写名字：先按名字在 timers 里找 id */
async function timerId(ctx: OpCtx, id: string, v: unknown): Promise<number> {
  const n = Number(v)
  if (v !== '' && Number.isFinite(n)) return n
  const name = String(v ?? '').trim()
  if (!name) throw new BridgeError(t('要给 timer（计时器的名字或 id）'))
  const res = (await traceQuery(ctx, id, { what: 'timers', filter: name, top: 20 })) as TraceRes & { items: TimerRow[] }
  const hit = res.items.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? res.items[0]
  if (!hit) throw new BridgeError(t('没有叫「{name}」的计时器', { name }))
  return hit.id
}

async function laneId(ctx: OpCtx, id: string, v: unknown): Promise<number> {
  const n = Number(v)
  if (v !== undefined && v !== '' && Number.isFinite(n)) return n
  const info = await traceQuery(ctx, id, { what: 'info' })
  const threads = (info.threads as { id: number; name: string }[]) ?? []
  const name = String(v || 'GameThread').toLowerCase()
  const hit =
    threads.find((x) => x.name.toLowerCase() === name) ?? threads.find((x) => x.name.toLowerCase().includes(name))
  if (!hit)
    throw new BridgeError(
      t('没有叫「{name}」的线程（有：{list}）', {
        name,
        list: threads
          .map((x) => x.name)
          .slice(0, 20)
          .join('、'),
      }),
    )
  return hit.id
}

interface Node {
  id: number
  name: string
  count: number
  incl: number
  children?: Node[]
  more?: number
}

/** 调用树裁剪：每层前 8 个、最多 6 层，Agent 看主干就够，要细节再换计时器查 */
const trim = (n: Node, depth = 0): Node => ({
  id: n.id,
  name: n.name,
  count: n.count,
  incl: n.incl,
  ...(n.children?.length && depth < 6
    ? {
        children: n.children.slice(0, 8).map((k) => trim(k, depth + 1)),
        ...(n.children.length > 8 || n.more ? { more: n.children.length - 8 + (n.more ?? 0) } : {}),
      }
    : n.children?.length
      ? { more: n.children.length }
      : {}),
})

export async function traceAgentQuery(ctx: OpCtx, id: string, q: Record<string, unknown>) {
  const what = String(q.what ?? '')
  const top = Math.min(Math.max(1, Number(q.top) || 30), 100)
  const range = clean(await rangeOf(ctx, id, q))
  const wrap = async (args: Record<string, unknown>) => {
    const res = await traceQuery(ctx, id, args)
    if (res.analyzing) throw new BridgeError(ANALYZING(res).next)
    return res
  }
  switch (what) {
    case 'frames': {
      const f = (await wrap({ what: 'frames' })) as TraceRes & Frames
      const thr = Number(q.thresholdMs) || 0
      const list = worstFrames(f, f.ms.length).filter(
        (x) =>
          x.ms >= thr && (range.t0 === undefined || x.at >= range.t0) && (range.t1 === undefined || x.at <= range.t1),
      )
      return { stats: frameStats(f), worst: list.slice(0, top) }
    }
    case 'timers': {
      const res = (await wrap({
        what: 'timers',
        ...range,
        filter: q.name ? String(q.name) : undefined,
        sort: q.sort,
        top,
      })) as TraceRes & {
        items: TimerRow[]
        total: number
        seconds: number
      }
      return {
        range: { from: range.t0 ?? 0, to: range.t1 ?? res.duration },
        total: res.total,
        items: res.items.map(brief),
      }
    }
    case 'butterfly': {
      const timer = await timerId(ctx, id, q.timer ?? q.name)
      const res = (await wrap({ what: 'butterfly', timer, ...range })) as TraceRes & { callers: Node; callees: Node }
      return {
        timer,
        callers: trim(res.callers),
        callees: trim(res.callees),
        note: '时间单位毫秒；callers 根是选中的计时器，往下是调用它的上一层、再上一层',
      }
    }
    case 'instances': {
      // 一个计时器每次调用的统计和最慢的几次：先看是「每次都慢」还是「偶尔一次特别慢」
      const timer = await timerId(ctx, id, q.timer ?? q.name)
      const res = (await wrap({ what: 'instances', timer, ...range, top: Math.min(top, 20) })) as TraceRes & {
        items: { lane: number; start: number; ms: number; excl: number; depth: number }[]
      }
      const { analyzing: _a, duration: _d, ...rest } = res
      return {
        ...rest,
        items: res.items.map((x) => ({ ...x, start: Math.round(x.start * 1e5) / 1e5 })),
        note: '时间单位毫秒；items 是最慢的几次（lane 是线程 id，start 是秒），用 what=stack lane=… time=… 看那一次的调用堆栈',
      }
    }
    case 'stack': {
      const lane = await laneId(ctx, id, q.lane ?? q.thread)
      const time = Number(q.time ?? range.t0)
      if (!Number.isFinite(time)) throw new BridgeError(t('要给 time（秒），或者 frame 看那一帧的开始'))
      return wrap({ what: 'stack', lane, time, depth: q.depth === undefined ? -1 : Number(q.depth) })
    }
    case 'threads': {
      const info = await wrap({ what: 'info' })
      return { threads: info.threads }
    }
    case 'log': {
      const res = (await wrap({
        what: 'log',
        ...range,
        filter: q.name ? String(q.name) : undefined,
        top,
      })) as TraceRes & {
        items: { t: number; v: string; c: string; m: string }[]
        total: number
      }
      return {
        total: res.total,
        items: res.items.map((x) => ({ at: r2(x.t), verbosity: x.v, category: x.c, message: x.m.slice(0, 400) })),
      }
    }
    case 'bookmarks':
      return wrap({ what: 'bookmarks' })
    case 'counters': {
      if (!q.name) return wrap({ what: 'counters' })
      const res = (await wrap({ what: 'counters', names: [String(q.name)], ...range, px: 60 })) as TraceRes & {
        series: { name: string; t: number[]; v: number[] }[]
      }
      const s = res.series[0]
      if (!s) throw new BridgeError(t('没有叫「{name}」的计数器（不写 name 列出全部）', { name: String(q.name) }))
      const vs = [...s.v].sort((a, b) => a - b)
      return { name: s.name, min: vs[0], max: vs.at(-1), points: s.t.map((x, i) => [r2(x), s.v[i]]) }
    }
    default:
      throw new BridgeError(
        t('trace 的 what：frames / timers / butterfly / instances / stack / threads / log / bookmarks / counters'),
      )
  }
}

/** 在 Unreal Insights 里打开（引擎自带的 UnrealInsights，不等它） */
export async function openInInsights(p: UeProject, id: string) {
  const cap = await traceCapture(p, id)
  const bin = path.join(p.engine.dir, 'Engine', 'Binaries')
  const file =
    process.platform === 'win32'
      ? path.join(bin, 'Win64', 'UnrealInsights.exe')
      : process.platform === 'darwin'
        ? path.join(bin, 'Mac', 'UnrealInsights.app', 'Contents', 'MacOS', 'UnrealInsights')
        : path.join(bin, 'Linux', 'UnrealInsights')
  if (!exists(file))
    throw new BridgeError(
      t('没找到 {f}：这个引擎没有编译 Unreal Insights（源码版要先编一下 UnrealInsights 目标）', { f: file }),
    )
  const child = spawn(file, [cap.file], { detached: true, stdio: 'ignore' })
  child.unref()
  return { opened: cap.file, pid: child.pid }
}
