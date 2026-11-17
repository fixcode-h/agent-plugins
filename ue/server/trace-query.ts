import { spawn } from 'node:child_process'
import path from 'node:path'
import { getCapture, type Capture } from './captures.ts'
import { autoBackground, ensureBackground, noBackgroundMsg } from './editor.ts'
import { BridgeError, liveCards, rpc, type Card } from './instances.ts'
import type { OpCtx } from './ops.ts'
import { isRecordingTrace } from './perf.ts'
import { shiftArgs, shiftResult } from './perf/trace-origin.ts'
import { LUA_TRACE_BRIDGE } from './perf/lua-trace.ts'
import { trimTree, type TreeNode } from './perf/trace-trim.ts'
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
    (autoBackground() ? await ensureBackground(p) : undefined)
  if (!card) throw new BridgeError(noBackgroundMsg())
  if (!newer(card.bridge || '0', TRACE_BRIDGE))
    throw new BridgeError(
      t('{kind} 里的桥接是 {v}，分析 trace 要 {min} 以上：在「UE 插件」里更新桥接插件，重新编译后再打开', {
        kind: card.kind === 'editor' ? t('编辑器') : t('后台编辑器'),
        v: card.bridge || '?',
        min: TRACE_BRIDGE,
      }),
    )
  return card
}

export interface TraceRes extends Record<string, unknown> {
  analyzing: boolean
  /** 秒，从录制开始算（桥接 2.8.1 起；旧桥接从进程启动算） */
  duration: number
  /** 桥接 2.8.1 起：已交给分析器的字节数 / 文件大小、读到了文件末尾、正在跟着录制往下读 */
  readBytes?: number
  fileBytes?: number
  caughtUp?: boolean
  live?: boolean
}

async function traceCapture(p: UeProject, id: string): Promise<Capture> {
  const cap = await getCapture(p, id)
  if (cap.kind !== 'trace') throw new BridgeError(t('{id} 不是 trace（.utrace）', { id }))
  return cap
}

/** 每份 trace 第一帧的时间（见 perf/trace-origin.ts）：带时间参数的查询要先知道它才能换算 */
const origins = new Map<string, number>()

/**
 * 网页和 Agent 共用：what 见桥接 AgentPanelTrace.cpp（info / frames / timing / timers / butterfly / stack / counters / log / bookmarks）。
 * 这份文件还在录时带 live：桥接跟着文件往下读，没分析完也能查已经分析到的部分（2.8.1 之前每次都从头重新分析）。
 */
export async function traceQuery(ctx: OpCtx, id: string, args: Record<string, unknown>): Promise<TraceRes> {
  const cap = await traceCapture(ctx.project, id)
  const card = await analysisCard(ctx.project)
  const live = await isRecordingTrace(ctx.project.id, cap.file)
  const call = async (a: Record<string, unknown>) => {
    const { ok: _ok, ...res } = await rpc(card, 'trace.query', { ...a, file: cap.file, live }, 60000)
    if (typeof res.origin === 'number' && res.origin > 0) {
      if (origins.size > 50) origins.clear()
      origins.set(cap.file, res.origin)
    }
    return res
  }
  try {
    const what = String(args.what ?? 'info')
    let origin = origins.get(cap.file)
    if (origin === undefined && (args.t0 !== undefined || args.t1 !== undefined || args.time !== undefined)) {
      await call({ what: 'info' })
      origin = origins.get(cap.file)
    }
    const res = await call(shiftArgs(args, origin ?? 0))
    return shiftResult(what, res, origin ?? (typeof res.origin === 'number' ? res.origin : 0)) as TraceRes
  } catch (e) {
    const msg = (e as Error).message
    if (/trace\.query/.test(msg))
      throw new BridgeError(t('这个进程的桥接还没有 trace 分析：更新桥接插件到 {min} 以上', { min: TRACE_BRIDGE }))
    throw e
  }
}

/** 分析进度：桥接 2.8.1 起按字节，旧桥接只有分析到的秒数 */
export function progressText(res: TraceRes) {
  const mb = (n: number) => (n / 1048576).toFixed(n >= 1048576 * 100 ? 0 : 1)
  if (res.fileBytes)
    return t('已读 {a} / {b} MB', { a: mb(res.readBytes ?? 0), b: mb(res.fileBytes) })
  return t('已经分析到第 {s} 秒', { s: Math.round(res.duration * 100) / 100 })
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
  /** Lua 计时器（UELink 2.9 起）：.lua 文件和定义行；C 函数 file 是 <lua:C>、c=true */
  file?: string
  line?: number
  c?: boolean
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
  next: t('还在分析（{p}），过几秒再查', { p: progressText(res) }),
})

/** 还要等：没分析完，而且不是「录制中、已经追上最新」（那时已有的部分就能查，后面的还在录） */
const waiting = (res: TraceRes) => res.analyzing && !(res.live && res.caughtUp)
const RECORDING = { recording: true, note: '这份 trace 还在录，结果只含已经录下的部分；停止录制后再查是完整的' }

export async function traceSummary(ctx: OpCtx, id: string) {
  const info = await traceQuery(ctx, id, { what: 'info' })
  if (waiting(info)) return ANALYZING(info)
  const frames = (await traceQuery(ctx, id, { what: 'frames' })) as TraceRes & Frames
  const timers = (await traceQuery(ctx, id, { what: 'timers', top: 15 })) as TraceRes & { items: TimerRow[] }
  const marks = (await traceQuery(ctx, id, { what: 'bookmarks' })) as TraceRes & {
    items: { t: number; text: string }[]
  }
  const threads = (info.threads as { id: number; name: string; group: string }[]) ?? []
  return {
    ...(info.live ? RECORDING : {}),
    seconds: r2(info.duration),
    frames: frameStats(frames),
    worstFrames: worstFrames(frames, 8),
    threads: threads.slice(0, 30).map((x) => ({ lane: x.id, name: x.name, group: x.group || undefined })),
    topTimers: timers.items.map(brief),
    bookmarks: marks.items.slice(0, 30).map((m) => ({ at: r2(m.t), name: m.text })),
    next: 'query what=timers（from/to 或 frame 限定范围）→ what=butterfly timer=<名字或 id> 看调用者 / 被调用者 → what=stack lane=<泳道> time=<秒> 看那一刻的调用堆栈',
    // 录了 Lua 的 trace（UELink 2.9 起 info 带 lua）：提示怎么只看 Lua
    ...(info.lua
      ? {
          lua: true,
          luaNext:
            'Lua 热点：what=timers lua=true（mergeC=true 把 C 函数并进调用者）→ what=tree luaOnly=true 看 Lua 调用关系 → 按 src 的 文件:行 读源码',
        }
      : {}),
  }
}

const NO_LUA =
  '没有 Lua 计时器：这份 trace 没录 Lua（ue_perf action=start lua=true），或者分析用的 UELink 低于 2.9.0（去 UE 页「UE 插件」升级）'

const brief = (x: TimerRow) => ({
  id: x.id,
  name: x.name,
  count: x.count,
  inclMs: x.incl,
  exclMs: x.excl,
  maxMs: x.inclMax,
  ...(x.gpu ? { gpu: true } : {}),
  // Lua 计时器带 文件:行（Agent 直接拿去读源码）；C 函数没有源码，只标 c
  ...(x.file && !x.c ? { src: x.line ? `${x.file}:${x.line}` : x.file } : {}),
  ...(x.c ? { c: true } : {}),
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
    if (waiting(res)) throw new BridgeError(ANALYZING(res).next)
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
      // lua：只要 Lua 计时器（含 C 函数）；mergeC：C 函数的时间并进调用它的 Lua 函数（UELink 2.9 起，设计稿 9.2）
      const lua = q.lua === true || q.lua === 'true'
      const mergeC = q.mergeC === true || q.mergeC === 'true'
      const res = (await wrap({
        what: 'timers',
        ...range,
        filter: q.name ? String(q.name) : undefined,
        sort: q.sort,
        top,
        ...(lua ? { lua: true } : {}),
        ...(mergeC ? { mergeC: true } : {}),
      })) as TraceRes & {
        items: TimerRow[]
        total: number
        seconds: number
      }
      return {
        range: { from: range.t0 ?? 0, to: range.t1 ?? res.duration },
        total: res.total,
        items: res.items.map(brief),
        ...(lua && res.items.length && !res.items.some((x) => x.file) ? { note: NO_LUA } : {}),
      }
    }
    case 'tree': {
      // 自上而下调用树：root 从某个计时器往下看，luaOnly 从最外层的 Lua 函数开始（跳过上面的 UE 作用域、各线程合并）
      const rootArg = q.root ?? q.timer
      const root = rootArg !== undefined && rootArg !== '' ? await timerId(ctx, id, rootArg) : undefined
      let res: TraceRes & { root?: TreeNode }
      try {
        // 直接调 traceQuery（不经 wrap）：只有桥接报的错补升级提示，还在分析的提示原样给
        res = (await traceQuery(ctx, id, {
          what: 'tree',
          ...range,
          ...(root !== undefined ? { root } : {}),
          ...(q.luaOnly === true || q.luaOnly === 'true' ? { luaOnly: true } : {}),
          ...(q.mergeC === true || q.mergeC === 'true' ? { mergeC: true } : {}),
        })) as TraceRes & { root?: TreeNode }
      } catch (e) {
        if (e instanceof BridgeError && /UELink|桥接/.test(e.message)) throw e
        throw new BridgeError(
          t('{msg}（what=tree 要分析用的编辑器里 UELink 是 {min} 起，去 UE 页「UE 插件」升级）', {
            msg: (e as Error).message,
            min: LUA_TRACE_BRIDGE,
          }),
        )
      }
      if (res.analyzing) throw new BridgeError(ANALYZING(res).next)
      if (!res.root) throw new BridgeError(t('分析用的 UELink 没返回调用树：要 {min} 起', { min: LUA_TRACE_BRIDGE }))
      // 给了 root 时桥接的根（id -1「全部」）下面只有它一个孩子：直接从它开始，少一层
      const top = root !== undefined && res.root.children?.length === 1 ? res.root.children[0] : res.root
      return {
        range: { from: range.t0 ?? 0, to: range.t1 ?? res.duration },
        root: trimTree(top),
        note: '时间单位毫秒；每层只留最热的几支（按包含时间），more 是没列出的子节点数；要看某一支往下就用它的 id 当 root 再查',
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
        t(
          'trace 的 what：frames / timers / tree / butterfly / instances / stack / threads / log / bookmarks / counters',
        ),
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
