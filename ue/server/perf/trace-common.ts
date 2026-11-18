import { getCapture } from '../captures.ts'
import { BridgeError } from '../instances.ts'
import type { OpCtx } from '../ops.ts'
import { isRecordingTrace } from '../perf.ts'
import { progressText, traceQuery, type TraceRes } from '../trace-query.ts'
import { t } from '../util.ts'

/**
 * Agent 分析 trace 的公共部分（「UE 性能分析 MCP 接口」设计稿 4.3、4.4）：
 * 发查询、等分析、范围（秒 / 书签 / 帧）、计时器和线程按名字找、分页信封、结果缓存。
 * 各类 what 的实现在同目录的 trace-*.ts，入口是 trace-agent.ts。
 */

export interface Frames {
  start: number[]
  ms: number[]
  total: number
}
export interface TimerRow {
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
export type Q = Record<string, unknown>

/** UELink 2.11 起才有的查询（framestats、framediff、session、memtags……）；旧桥接上走面板的兜底算法或提示升级 */
export const ALL_DATA_BRIDGE = '2.11.0'

export const r2 = (n: number) => Math.round(n * 100) / 100
export const pct = (sorted: number[], q: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0
export const median = (xs: number[]) =>
  pct(
    [...xs].sort((a, b) => a - b),
    0.5,
  )
export const flag = (v: unknown) => v === true || v === 'true'

export const ANALYZING = (res: TraceRes) => ({
  analyzing: true,
  analyzedSeconds: r2(res.duration),
  next: t('还在分析（{p}）：用 ue_perf action=wait id=… 等分析完，或过几秒再查', { p: progressText(res) }),
})

/** 还要等：没分析完，而且不是「录制中、已经追上最新」（那时已有的部分就能查，后面的还在录） */
export const waiting = (res: TraceRes) => res.analyzing && !(res.live && res.caughtUp)

/** 查询并要求已经分析完（或录制中已追上）；还在分析时抛出带进度的提示 */
export async function q(ctx: OpCtx, id: string, args: Q): Promise<TraceRes & Q> {
  const res = await traceQuery(ctx, id, args)
  if (waiting(res)) throw new BridgeError(ANALYZING(res).next)
  return res as TraceRes & Q
}

/** 桥接不认识这个 what（UELink 低于 2.11）：调用方走兜底或提示升级 */
export const unknownWhat = (e: unknown) => /不认识的查询/.test((e as Error)?.message ?? '')

export const needBridge = (what: string) =>
  new BridgeError(
    t('what={what} 要分析用的编辑器里 UELink 是 {min} 起：去 UE 页「UE 插件」升级 UELink，重新编译后再打开编辑器', {
      what,
      min: ALL_DATA_BRIDGE,
    }),
  )

/** 统一的分页信封（设计稿 4.4）：默认 30 条，最多 200 */
export function page<T>(all: T[], qy: Q, def = 30) {
  const top = Math.min(Math.max(1, Number(qy.top) || def), 200)
  const offset = Math.max(0, Number(qy.offset) || 0)
  const items = all.slice(offset, offset + top)
  const hasMore = offset + items.length < all.length
  return {
    count: items.length,
    offset,
    total: all.length,
    hasMore,
    ...(hasMore ? { nextOffset: offset + items.length } : {}),
    items,
  }
}

/** 默认值不写：false、null、undefined、空数组、空串都去掉，省 token（设计稿 4.4） */
export function compact<T>(o: T): T {
  if (Array.isArray(o)) return o.map(compact) as T
  if (!o || typeof o !== 'object') return o
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (v === undefined || v === null || v === false || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = compact(v)
  }
  return out as T
}

// ---------- 结果缓存：同一份 trace 的帧表、帧内线程统计会被多个 what 反复用到 ----------

const cache = new Map<string, { at: number; v: unknown }>()

/** 按文件和大小缓存（文件变了就是新的）；录制中的不缓存 */
export async function cached<T>(ctx: OpCtx, id: string, key: string, make: () => Promise<T>): Promise<T> {
  const cap = await getCapture(ctx.project, id)
  const k = `${cap.file}|${cap.size}|${key}`
  const hit = cache.get(k)
  if (hit) return hit.v as T
  const v = await make()
  if (await isRecordingTrace(ctx.project.id, cap.file)) return v
  if (cache.size > 40) cache.delete(cache.keys().next().value as string)
  cache.set(k, { at: Date.now(), v })
  return v
}

export async function framesOf(ctx: OpCtx, id: string, type?: string): Promise<Frames> {
  return cached(ctx, id, `frames:${type ?? ''}`, async () => {
    const f = (await q(ctx, id, { what: 'frames', ...(type === 'render' ? { type: 'render' } : {}) })) as TraceRes &
      Frames
    return { start: f.start, ms: f.ms, total: f.total }
  })
}

export function frameStats(f: Pick<Frames, 'ms'>) {
  const sorted = [...f.ms].sort((a, b) => a - b)
  const avg = f.ms.reduce((s, x) => s + x, 0) / Math.max(1, f.ms.length)
  // 最差 1% 帧的平均帧率（游戏里常说的 1% low）
  const worst = sorted.slice(Math.floor(sorted.length * 0.99))
  const low1 = worst.length ? worst.reduce((s, x) => s + x, 0) / worst.length : 0
  return {
    count: f.ms.length,
    avgMs: r2(avg),
    p50Ms: r2(pct(sorted, 0.5)),
    p95Ms: r2(pct(sorted, 0.95)),
    p99Ms: r2(pct(sorted, 0.99)),
    maxMs: r2(sorted.at(-1) ?? 0),
    fps: avg ? r2(1000 / avg) : 0,
    low1Fps: low1 ? r2(1000 / low1) : 0,
  }
}

export async function bookmarksOf(ctx: OpCtx, id: string) {
  return cached(ctx, id, 'bookmarks', async () => {
    const r = (await q(ctx, id, { what: 'bookmarks' })) as TraceRes & { items: { t: number; text: string }[] }
    return r.items
  })
}

export interface Range {
  t0?: number
  t1?: number
  /** 帧号范围 [f0, f1)：给了 frame / frames 时 */
  f0?: number
  f1?: number
}

/** from / to：秒数或书签名；frame：只看这一帧；frames："120-180" 帧区间 */
export async function rangeOf(ctx: OpCtx, id: string, qy: Q): Promise<Range> {
  const byFrames = async (a: number, b: number) => {
    const f = await framesOf(ctx, id)
    if (!(a >= 0 && a < f.start.length))
      throw new BridgeError(t('没有第 {i} 帧（共 {n} 帧）', { i: String(a), n: f.start.length }))
    const last = Math.min(f.start.length - 1, Math.max(a, b))
    return { t0: f.start[a], t1: f.start[last] + f.ms[last] / 1000, f0: a, f1: last + 1 }
  }
  if (qy.frame !== undefined && qy.frame !== '') return byFrames(Number(qy.frame), Number(qy.frame))
  if (typeof qy.frames === 'string' && /^\s*\d+\s*-\s*\d+\s*$/.test(qy.frames)) {
    const [a, b] = qy.frames.split('-').map((x) => Number(x.trim()))
    return byFrames(a, b)
  }
  let marks: { t: number; text: string }[] | undefined
  const at = async (v: unknown) => {
    if (v === undefined || v === null || v === '') return undefined
    const n = Number(v)
    if (Number.isFinite(n)) return n
    marks ??= await bookmarksOf(ctx, id)
    const name = String(v).toLowerCase()
    const hit =
      marks.find((m) => m.text.toLowerCase() === name) ?? marks.find((m) => m.text.toLowerCase().includes(name))
    if (!hit)
      throw new BridgeError(
        t('from / to 要写秒数或书签的名字，这份 trace 里没有叫「{name}」的书签', { name: String(v) }),
      )
    return hit.t
  }
  const out: Range = {}
  const t0 = await at(qy.from)
  const t1 = await at(qy.to)
  if (t0 !== undefined) out.t0 = t0
  if (t1 !== undefined) out.t1 = t1
  return out
}

/** 只留桥接要的 t0 / t1 */
export const timeArgs = (r: Range) => ({
  ...(r.t0 !== undefined ? { t0: r.t0 } : {}),
  ...(r.t1 !== undefined ? { t1: r.t1 } : {}),
})

/** 帧号范围：给了 frame / frames 用它，否则按时间范围换算 */
export function frameSpan(f: Frames, r: Range): [number, number] {
  if (r.f0 !== undefined && r.f1 !== undefined) return [r.f0, r.f1]
  let a = 0
  let b = f.start.length
  if (r.t0 !== undefined) while (a < b && f.start[a] < r.t0) a++
  if (r.t1 !== undefined) while (b > a && f.start[b - 1] > r.t1) b--
  return [a, b]
}

export interface Thread {
  id: number
  name: string
  group?: string
}

export async function threadsOf(ctx: OpCtx, id: string): Promise<Thread[]> {
  return cached(ctx, id, 'threads', async () => {
    const info = await q(ctx, id, { what: 'info' })
    return (info.threads as Thread[]) ?? []
  })
}

/** 线程写名字或 id，可写多个（逗号分隔）；名字有歧义时报错列出候选，不悄悄挑一个（设计稿 4.4） */
export async function laneIds(ctx: OpCtx, id: string, v: unknown): Promise<number[] | undefined> {
  if (v === undefined || v === null || v === '') return undefined
  const threads = await threadsOf(ctx, id)
  const parts = Array.isArray(v) ? v.map(String) : String(v).split(',')
  const out: number[] = []
  for (const raw of parts.map((x) => x.trim()).filter(Boolean)) {
    const n = Number(raw)
    if (Number.isFinite(n)) {
      out.push(n)
      continue
    }
    const name = raw.toLowerCase()
    const exact = threads.filter((x) => x.name.toLowerCase() === name)
    const part = exact.length ? exact : threads.filter((x) => x.name.toLowerCase().includes(name))
    if (part.length === 1 || (part.length > 1 && exact.length === 1)) {
      out.push(part[0].id)
      continue
    }
    if (part.length > 1)
      throw new BridgeError(
        t('「{name}」对得上好几条线程：{list}。写全名或泳道 id', {
          name: raw,
          list: part
            .slice(0, 10)
            .map((x) => `${x.name}(${x.id})`)
            .join('、'),
        }),
      )
    throw new BridgeError(
      t('没有叫「{name}」的线程（有：{list}）', {
        name: raw,
        list: threads
          .map((x) => x.name)
          .slice(0, 20)
          .join('、'),
      }),
    )
  }
  return out
}

/** 计时器可以写名字：先按名字在 timers 里找 id；有好几个同样像的时报错列出候选 */
export async function timerId(ctx: OpCtx, id: string, v: unknown): Promise<number> {
  const n = Number(v)
  if (v !== '' && v !== undefined && Number.isFinite(n)) return n
  const name = String(v ?? '').trim()
  if (!name) throw new BridgeError(t('要给 timer（计时器的名字或 id）'))
  const res = (await q(ctx, id, { what: 'timers', filter: name, top: 20 })) as TraceRes & { items: TimerRow[] }
  const exact = res.items.filter((x) => x.name.toLowerCase() === name.toLowerCase())
  if (exact.length >= 1) return exact[0].id
  if (res.items.length === 1) return res.items[0].id
  if (!res.items.length) throw new BridgeError(t('没有叫「{name}」的计时器', { name }))
  throw new BridgeError(
    t('「{name}」对得上好几个计时器，写全名或 id：{list}', {
      name,
      list: res.items
        .slice(0, 10)
        .map((x) => `${x.name}(${x.id})`)
        .join('、'),
    }),
  )
}

export const brief = (x: TimerRow) => ({
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

/** 线程按名字归类：瓶颈判断只看这四类 */
export type LaneKind = 'game' | 'render' | 'rhi' | 'gpu' | 'other'
export function laneKind(name: string, id?: number): LaneKind {
  if (id === -1 || /^GPU/i.test(name)) return 'gpu'
  if (/GameThread/i.test(name)) return 'game'
  if (/RenderThread/i.test(name)) return 'render'
  if (/RHIThread/i.test(name)) return 'rhi'
  return 'other'
}
