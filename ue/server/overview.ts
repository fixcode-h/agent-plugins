import { logTail } from './actions.ts'
import type { Card } from './instances.ts'
import { olderVersion } from './instances.ts'
import { crashes, type Crash } from './logs.ts'
import { runOp, type OpCtx } from './ops.ts'
import { LIVE_BRIDGE, liveRead } from './perf-live.ts'

/**
 * 概览页「需要你处理」「最近发生的」和帧时间读数要的数（设计稿 designs/UE插件优化与扩展-设计稿.md 三.1）。
 * 跟着左栏徽标的同一个请求走（badges?overview=1），只在概览页加这几项，不另起轮询；每项单独兜底，取不到就不显示
 */
export interface OverviewExtra {
  /** 24 小时内最近的一次崩溃（Saved/Crashes），没有就不给 */
  crash?: Crash
  /** 改了没保存的资源，最多 5 个包名（总数在 badges.dirty） */
  dirtyNames: string[]
  /** 最近 0.5 秒的平均帧时间（毫秒），和 stat unit 同源；旧桥接、没进程时没有 */
  frame?: { frame: number; game: number; gpu: number }
  /** 最近几条错误和警告（时间线用），at 是本机毫秒时间戳，旧桥接没给时没有 */
  logs: { at?: number; level: 'error' | 'warning'; category: string; text: string }[]
}

const DAY = 24 * 3600 * 1000

export async function overviewExtra(ctx: OpCtx, cards: Card[], dirty: { package: string }[] | undefined) {
  const quiet = <T>(x: Promise<T>) => x.catch(() => undefined)
  const live = cards.length > 0
  // perf.live 是桥接每帧记的环形缓冲，读一次很轻；第一次取时桥接才开始采（10 秒没人取就停），所以概览刚打开时帧时间先空一次。
  // 只在概览页取（这个请求 5 秒一次，正好让采样一直开着），旧桥接没有这个操作
  const perf = live && cards.some((c) => !olderVersion(c.bridge, LIVE_BRIDGE))
  const [crash, frame, logs] = await Promise.all([
    quiet(crashes(ctx.project, 1).then((l) => l.find((c) => Date.now() - Date.parse(c.at) < DAY))),
    perf ? quiet(liveRead(ctx, 0, 120).then(avgFrame)) : undefined,
    // UE 没在运行时日志要从文件里筛，几个 GB 的文件每 5 秒扫一遍太重：只在有进程时取
    live ? quiet(recentLogs(ctx)) : undefined,
  ])
  const out: OverviewExtra = {
    crash,
    dirtyNames: (dirty ?? []).slice(0, 5).map((d) => d.package.split('/').pop() ?? d.package),
    frame,
    logs: logs ?? [],
  }
  return out
}

/** 最近 0.5 秒的平均：单帧跳动太大不好读（性能页读数条同样的算法） */
function avgFrame(r: Awaited<ReturnType<typeof liveRead>>) {
  const f = r.frames
  const idx = f.at.map((a, i) => (a >= -0.5 ? i : -1)).filter((i) => i >= 0)
  const use = idx.length ? idx : f.at.length ? [f.at.length - 1] : []
  if (!use.length) return undefined
  const avg = (arr: number[]) => Math.round((use.reduce((s, i) => s + (arr[i] ?? 0), 0) / use.length) * 10) / 10
  return { frame: avg(f.frame), game: avg(f.game), gpu: avg(f.gpu) }
}

async function recentLogs(ctx: OpCtx) {
  const r = (await logTail(ctx, { verbosity: 'Warning', limit: 6 })) as {
    lines?: { at?: number; verbosity?: string; category?: string; text?: string }[]
  }
  return (r.lines ?? []).map((l) => ({
    at: typeof l.at === 'number' ? l.at : undefined,
    level: /error|fatal/i.test(l.verbosity ?? '') ? ('error' as const) : ('warning' as const),
    category: l.category ?? '',
    text: (l.text ?? '').slice(0, 300),
  }))
}

/** 改了没保存的资源（badges 里数个数，概览再列前几个名字） */
export async function dirtyList(ctx: OpCtx) {
  const r = await runOp(ctx, 'asset.dirty', {}, 3000)
  return (r.items as { package: string }[]) ?? []
}
