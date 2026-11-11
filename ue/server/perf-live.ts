import { BridgeError } from './instances.ts'
import { runOp, type OpCtx } from './ops.ts'
import { t } from './util.ts'

/**
 * 实时读数（性能页设计 3.1）：桥接 perf.live 每帧记一条和 stat unit 同源的数，这里按游标取。
 * 网页每 0.5 秒取一次画读数条和曲线；Agent 的 ue_perf action=live 取最近几秒算个摘要。
 */
export const LIVE_BRIDGE = '1.3.0'

export interface LiveFrames {
  /** 距 UE 当前时间多少秒前（负数） */
  at: number[]
  frame: number[]
  game: number[]
  draw: number[]
  rhi: number[]
  gpu: number[]
  /** -1：这个引擎版本不读 */
  draws: number[]
  prims: number[]
  /** 已用物理内存 MB */
  mem: number[]
  objects: number[]
}
export interface LiveRes {
  frames: LiveFrames
  cursor: number
  from: number
  gap: boolean
  sampling: number
  thresholds: { target: number; unacceptable: number }
  memory: {
    usedPhysicalMB: number
    peakPhysicalMB: number
    usedVirtualMB: number
    peakVirtualMB: number
    availablePhysicalMB: number
    totalPhysicalMB: number
  }
  drawStats: boolean
  instance?: { pid: number; kind: string }
}

export async function liveRead(ctx: OpCtx, since: number, limit = 600): Promise<LiveRes> {
  try {
    return (await runOp(ctx, 'perf.live', { since, limit }, 10000)) as unknown as LiveRes
  } catch (e) {
    const msg = (e as Error).message
    // 旧桥接没有这个操作：给出怎么升级，而不是只说「不支持」
    if (/perf\.live/.test(msg))
      throw new BridgeError(
        t('这个 UE 里的桥接插件是旧版本，没有实时读数：到「桥接与权限」更新到 {v}，重新编译并重启 UE', {
          v: LIVE_BRIDGE,
        }),
      )
    throw e
  }
}

const r1 = (n: number) => Math.round(n * 10) / 10
function stat(v: number[]) {
  if (!v.length) return undefined
  const s = [...v].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]
  return { avg: r1(v.reduce((a, b) => a + b, 0) / v.length), p95: r1(q(0.95)), max: r1(s[s.length - 1]) }
}

/** Agent 用：最近 seconds 秒的读数摘要。刚开始采样时缓冲是空的，等一下再取一次 */
export async function liveSummary(ctx: OpCtx, seconds = 5) {
  const want = Math.min(Math.max(1, seconds || 5), 60)
  let r = await liveRead(ctx, 0, 3600)
  if (r.sampling < want) {
    await new Promise((ok) => setTimeout(ok, Math.min(want - r.sampling + 0.3, 10) * 1000))
    r = await liveRead(ctx, 0, 3600)
  }
  const f = r.frames
  const idx = f.at.map((a, i) => (a >= -want ? i : -1)).filter((i) => i >= 0)
  const pick = (arr: number[]) => idx.map((i) => arr[i])
  const frame = pick(f.frame)
  const { target, unacceptable } = r.thresholds
  const avgFrame = stat(frame)?.avg ?? 0
  return {
    seconds: want,
    frames: idx.length,
    fps: avgFrame > 0 ? r1(1000 / avgFrame) : undefined,
    ms: {
      frame: stat(frame),
      game: stat(pick(f.game)),
      draw: stat(pick(f.draw)),
      rhi: stat(pick(f.rhi)),
      gpu: stat(pick(f.gpu)),
    },
    overTarget: frame.filter((x) => x > target).length,
    overUnacceptable: frame.filter((x) => x > unacceptable).length,
    thresholds: r.thresholds,
    drawCalls: r.drawStats ? stat(pick(f.draws)) : undefined,
    primitives: r.drawStats ? stat(pick(f.prims)) : undefined,
    memory: r.memory,
    uobjects: f.objects.length ? f.objects[f.objects.length - 1] : undefined,
    note: '和游戏里 stat unit 同源：frame 是整帧，game / draw / rhi 是游戏线程、渲染线程、RHI 线程的时间，gpu 是 GPU 时间，单位毫秒。哪个线程最接近 frame，瓶颈就在哪。要看具体是哪个函数慢，用 kind=csv 抓一段后 ue_capture 分析。',
  }
}
