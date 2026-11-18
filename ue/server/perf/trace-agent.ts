import { getCapture } from '../captures.ts'
import { BridgeError } from '../instances.ts'
import type { OpCtx } from '../ops.ts'
import { traceQuery, type TraceRes } from '../trace-query.ts'
import { t } from '../util.ts'
import { diagnose } from './diagnose.ts'
import { LUA_TRACE_BRIDGE } from './lua-trace.ts'
import {
  ANALYZING,
  bookmarksOf,
  brief,
  compact,
  flag,
  framesOf,
  frameStats,
  laneIds,
  page,
  q,
  r2,
  rangeOf,
  threadsOf,
  timeArgs,
  timerId,
  waiting,
  type Q,
  type TimerRow,
} from './trace-common.ts'
import { bookmarksQuery, countersQuery, eventsQuery, logQuery, passQuery, screenshotsQuery } from './trace-extra.ts'
import { boundQuery, boundSummary, frameQuery, frameStatsOf, threadsQuery } from './trace-frames.ts'
import { framesQuery, hitchesQuery } from './trace-hitches.ts'
import { trimTree, type TreeNode } from './trace-trim.ts'

/**
 * Agent 分析 trace 的入口（ue_capture 的 summary / diagnose / query，设计稿 4.3）：
 * summary 给整体，diagnose 给排好序的问题和可并行的方向，query 按 what 分派到各个文件。所有结果去掉默认值、限长。
 */

const RECORDING = { recording: true, note: '这份 trace 还在录，结果只含已经录下的部分；停止录制后再查是完整的' }
const NO_LUA =
  '没有 Lua 计时器：这份 trace 没录 Lua（ue_perf action=start lua=true），或者分析用的 UELink 低于 2.9.0（去 UE 页「UE 插件」升级）'

export async function traceSummary(ctx: OpCtx, id: string) {
  const info = await traceQuery(ctx, id, { what: 'info' })
  if (waiting(info)) return ANALYZING(info)
  const f = await framesOf(ctx, id)
  const timers = (await q(ctx, id, { what: 'timers', top: 12 })) as TraceRes & { items: TimerRow[] }
  const marks = await bookmarksOf(ctx, id)
  const threads = await threadsOf(ctx, id)
  const fs = await frameStatsOf(ctx, id).catch(() => undefined)
  const cap = await getCapture(ctx.project, id)
  const worst = f.ms
    .map((ms, i) => ({ frame: i, at: r2(f.start[i] ?? 0), ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 8)
  return compact({
    ...(info.live ? RECORDING : {}),
    seconds: r2(info.duration),
    frames: frameStats(f),
    ...(fs ? { bound: boundSummary(fs).share } : {}),
    worstFrames: worst,
    threads: threads.length,
    mainThreads: threads
      .filter((x) => /GameThread|RenderThread|RHIThread|^GPU/i.test(x.name))
      .map((x) => ({ lane: x.id, name: x.name })),
    topTimers: timers.items.map(brief),
    bookmarks: marks.slice(0, 30).map((m) => ({ at: r2(m.t), name: m.text })),
    shots: (cap.marks ?? []).filter((m) => m.shot).length || undefined,
    lua: !!info.lua,
    next: 'action=diagnose 一次给出排好序的问题和可并行深挖的方向；或 query what=hitches / bound / threads / timers',
    ...(info.lua
      ? {
          luaNext:
            'Lua 热点：what=timers lua=true（mergeC=true 把 C 函数并进调用者）→ what=tree luaOnly=true → 按 src 读源码',
        }
      : {}),
  })
}

export async function traceDiagnose(ctx: OpCtx, id: string, qy: Q) {
  const info = await traceQuery(ctx, id, { what: 'info' })
  if (waiting(info)) return ANALYZING(info)
  return compact({ ...(info.live ? RECORDING : {}), ...(await diagnose(ctx, id, qy)) })
}

async function timersQuery(ctx: OpCtx, id: string, qy: Q) {
  const r = await rangeOf(ctx, id, qy)
  const lua = flag(qy.lua)
  const lanes = await laneIds(ctx, id, qy.lane)
  const res = (await q(ctx, id, {
    what: 'timers',
    ...timeArgs(r),
    filter: qy.name ? String(qy.name) : undefined,
    sort: qy.sort,
    top: 200,
    ...(lanes ? { lanes } : {}),
    ...(lua ? { lua: true } : {}),
    ...(flag(qy.mergeC) ? { mergeC: true } : {}),
  })) as TraceRes & { items: TimerRow[]; total: number }
  // perFrame：再给每帧平均（毫秒），不同长度的范围之间好比
  let frames = 0
  if (flag(qy.perFrame)) {
    const f = await framesOf(ctx, id)
    frames = f.start.filter((s) => (r.t0 === undefined || s >= r.t0) && (r.t1 === undefined || s <= r.t1)).length
  }
  const items = res.items.map((x) => ({
    ...brief(x),
    ...(frames ? { perFrameMs: r2(x.excl / frames), perFrameInclMs: r2(x.incl / frames) } : {}),
  }))
  return {
    range: { from: r2(r.t0 ?? 0), to: r2(r.t1 ?? res.duration) },
    ...(lanes ? { lanes } : {}),
    ...(frames ? { frames } : {}),
    totalTimers: res.total,
    ...page(items, qy, 30),
    ...(lua && res.items.length && !res.items.some((x) => x.file) ? { note: NO_LUA } : {}),
  }
}

async function treeQuery(ctx: OpCtx, id: string, qy: Q) {
  const r = await rangeOf(ctx, id, qy)
  const rootArg = qy.root ?? qy.timer
  const root = rootArg !== undefined && rootArg !== '' ? await timerId(ctx, id, rootArg) : undefined
  const lanes = await laneIds(ctx, id, qy.lane)
  let res: TraceRes & { root?: TreeNode }
  try {
    res = (await traceQuery(ctx, id, {
      what: 'tree',
      ...timeArgs(r),
      ...(root !== undefined ? { root } : {}),
      ...(lanes ? { lanes } : {}),
      ...(flag(qy.luaOnly) ? { luaOnly: true } : {}),
      ...(flag(qy.mergeC) ? { mergeC: true } : {}),
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
  if (waiting(res)) throw new BridgeError(ANALYZING(res).next)
  if (!res.root) throw new BridgeError(t('分析用的 UELink 没返回调用树：要 {min} 起', { min: LUA_TRACE_BRIDGE }))
  const top = root !== undefined && res.root.children?.length === 1 ? res.root.children[0] : res.root
  return {
    range: { from: r2(r.t0 ?? 0), to: r2(r.t1 ?? res.duration) },
    root: trimTree(top, Number(qy.budget) > 0 ? Math.min(12000, Number(qy.budget)) : 4000),
    note: '时间毫秒；每层只留最热的几支（按包含时间），more 是没列出的子节点数；要看某一支往下就用它的 id 当 root 再查',
  }
}

async function butterflyQuery(ctx: OpCtx, id: string, qy: Q) {
  const r = await rangeOf(ctx, id, qy)
  const timer = await timerId(ctx, id, qy.timer ?? qy.name)
  const lanes = await laneIds(ctx, id, qy.lane)
  const res = (await q(ctx, id, {
    what: 'butterfly',
    timer,
    ...timeArgs(r),
    ...(lanes ? { lanes } : {}),
  })) as TraceRes & {
    callers: TreeNode
    callees: TreeNode
  }
  return {
    timer,
    callers: trimTree(res.callers, 3000),
    callees: trimTree(res.callees, 3000),
    note: '时间毫秒；callers 根是选中的计时器，往下是调用它的上一层、再上一层；callees 是它里面调了谁',
  }
}

async function instancesQuery(ctx: OpCtx, id: string, qy: Q) {
  const r = await rangeOf(ctx, id, qy)
  const timer = await timerId(ctx, id, qy.timer ?? qy.name)
  const lanes = await laneIds(ctx, id, qy.lane)
  const res = (await q(ctx, id, {
    what: 'instances',
    timer,
    ...timeArgs(r),
    top: Math.min(Math.max(1, Number(qy.top) || 15), 50),
    ...(lanes ? { lanes } : {}),
  })) as TraceRes & { items: { lane: number; start: number; ms: number; excl: number; depth: number }[] }
  const { analyzing: _a, duration: _d, origin: _o, ...rest } = res
  const f = await framesOf(ctx, id)
  const frameAt = (s: number) => {
    let lo = 0
    let hi = f.start.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (f.start[mid] <= s) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  return {
    ...rest,
    items: res.items.map((x) => ({ ...x, start: Math.round(x.start * 1e5) / 1e5, frame: frameAt(x.start) })),
    note: '时间毫秒；items 是最慢的几次（lane 是线程 id，start 是秒，frame 是所在帧），用 what=stack lane=… time=… 看那一次的调用堆栈',
  }
}

async function stackQuery(ctx: OpCtx, id: string, qy: Q) {
  const r = await rangeOf(ctx, id, qy)
  const lane = (await laneIds(ctx, id, qy.lane ?? qy.thread ?? 'GameThread'))![0]
  const time = Number(qy.time ?? r.t0)
  if (!Number.isFinite(time)) throw new BridgeError(t('要给 time（秒），或者 frame 看那一帧的开始'))
  return q(ctx, id, { what: 'stack', lane, time, depth: qy.depth === undefined ? -1 : Number(qy.depth) })
}

/** what 的说明（用错 what 时列出来） */
const WHATS =
  'frames / frame / hitches / bound / threads / timers / tree / butterfly / instances / stack / events / counters / log / bookmarks / regions / session / memtags / allocs / loads / files / tasks / switches / net / screenshots / screenshot'

export async function traceAgentQuery(ctx: OpCtx, id: string, qy: Q) {
  const what = String(qy.what ?? '')
  const run = async (): Promise<unknown> => {
    switch (what) {
      case 'frames':
        return framesQuery(ctx, id, qy)
      case 'frame':
        return frameQuery(ctx, id, qy)
      case 'hitches':
        return hitchesQuery(ctx, id, qy)
      case 'bound':
        return boundQuery(ctx, id, qy)
      case 'threads':
        return flag(qy.list)
          ? { threads: (await threadsOf(ctx, id)).map((x) => ({ lane: x.id, name: x.name, group: x.group })) }
          : threadsQuery(ctx, id, qy)
      case 'timers':
        return timersQuery(ctx, id, qy)
      case 'tree':
        return treeQuery(ctx, id, qy)
      case 'butterfly':
        return butterflyQuery(ctx, id, qy)
      case 'instances':
        return instancesQuery(ctx, id, qy)
      case 'stack':
        return stackQuery(ctx, id, qy)
      case 'events':
        return eventsQuery(ctx, id, qy)
      case 'counters':
        return countersQuery(ctx, id, qy)
      case 'log':
        return logQuery(ctx, id, qy)
      case 'bookmarks':
        return bookmarksQuery(ctx, id, qy)
      case 'screenshots':
      case 'screenshot':
        return screenshotsQuery(ctx, id, qy, what === 'screenshot')
      case 'session':
      case 'regions':
      case 'memtags':
      case 'allocs':
      case 'loads':
      case 'files':
      case 'tasks':
      case 'switches':
      case 'net':
        return passQuery(ctx, id, what, qy)
      default:
        throw new BridgeError(t('trace 的 what：{list}', { list: WHATS }))
    }
  }
  const res = (await run()) as Record<string, unknown>
  // 时间点统一保留到 0.01 秒以内的精度由各 what 自己处理；这里只去掉默认值
  return compact(res)
}
