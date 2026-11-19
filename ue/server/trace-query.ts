import { spawn } from 'node:child_process'
import path from 'node:path'
import { getCapture, type Capture } from './captures.ts'
import { autoBackground, ensureBackground, noBackgroundMsg } from './editor.ts'
import { BridgeError, liveCards, rpc, type Card } from './instances.ts'
import type { OpCtx } from './ops.ts'
import { isRecordingTrace } from './perf.ts'
import { shiftArgs, shiftResult } from './perf/trace-origin.ts'
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

/** 分析用的进程里的 UELink 版本（Agent 下钻据此决定用新查询还是旧桥接的兜底） */
export async function analysisBridge(p: UeProject) {
  return (await analysisCard(p)).bridge || '0'
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
  if (res.fileBytes) return t('已读 {a} / {b} MB', { a: mb(res.readBytes ?? 0), b: mb(res.fileBytes) })
  return t('已经分析到第 {s} 秒', { s: Math.round(res.duration * 100) / 100 })
}

// 给 Agent 的摘要和下钻在 perf/trace-agent.ts（按 what 分到 perf/trace-*.ts），这里只管挑进程和转发

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
