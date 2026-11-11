import { useEffect, useRef, useState } from 'react'
import type { Target } from '../../../server/types.ts'
import { ppost } from '../../api.ts'
import type { LiveRes } from './types.ts'

/**
 * 实时读数的轮询（性能页设计 3.1）：每 0.5 秒按游标从桥接取新的帧，网页这边留最近 60 秒的每帧数据（画读数条、帧条、线程曲线），
 * 另外每次取数时记一个内存点，留 10 分钟（内存视图的曲线）。数据放在模块里按「项目 + 进程」存，
 * 切到别的分区再回来曲线还在；换了进程（重启 UE、切目标）就从头开始。
 */
const KEEP_SECONDS = 60
const KEEP_FRAMES = 3600
const MEM_KEEP = 1200
const POLL_MS = 500

export interface LiveBuf {
  key: string
  cursor: number
  /** 本机时间戳（毫秒） */
  t: number[]
  frame: number[]
  game: number[]
  draw: number[]
  rhi: number[]
  gpu: number[]
  draws: number[]
  prims: number[]
  /** 每次取数记一个点，10 分钟 */
  mem: { t: number; used: number; virt: number; objects: number }[]
  last?: Omit<LiveRes, 'frames'>
}

const bufs = new Map<string, LiveBuf>()
const COLS = ['frame', 'game', 'draw', 'rhi', 'gpu', 'draws', 'prims'] as const

function fresh(key: string): LiveBuf {
  return { key, cursor: 0, t: [], frame: [], game: [], draw: [], rhi: [], gpu: [], draws: [], prims: [], mem: [] }
}

function append(b: LiveBuf, r: LiveRes) {
  const now = Date.now()
  const f = r.frames
  // 桥接重新挂上回调后会从缓冲里吐出很早以前的帧：只收最近 60 秒内的
  for (let i = 0; i < f.at.length; i++) {
    if (f.at[i] < -KEEP_SECONDS) continue
    b.t.push(now + f.at[i] * 1000)
    for (const c of COLS) b[c].push(f[c][i])
  }
  const cut = Math.max(
    0,
    b.t.length - KEEP_FRAMES,
    b.t.findIndex((x) => x >= now - KEEP_SECONDS * 1000),
  )
  if (cut > 0) {
    b.t.splice(0, cut)
    for (const c of COLS) b[c].splice(0, cut)
  }
  b.cursor = r.cursor
  const { frames: _f, ...rest } = r
  b.last = rest
  b.mem.push({
    t: now,
    used: r.memory.usedPhysicalMB,
    virt: r.memory.usedVirtualMB,
    objects: f.objects.length ? f.objects[f.objects.length - 1] : (b.mem.at(-1)?.objects ?? 0),
  })
  if (b.mem.length > MEM_KEEP) b.mem.splice(0, b.mem.length - MEM_KEEP)
}

export function useLive(project: string, target: Target, pid: number | undefined) {
  const key = `${project}|${pid ?? ''}`
  const [, setVer] = useState(0)
  const [error, setError] = useState('')
  const busy = useRef(false)
  useEffect(() => {
    if (!pid) return
    if (!bufs.has(key)) bufs.set(key, fresh(key))
    let stop = false
    const tick = async () => {
      if (stop || busy.current || document.hidden) return
      busy.current = true
      const b = bufs.get(key)!
      try {
        const r = await ppost<LiveRes>(project, 'perf/live', { since: b.cursor, limit: 600, target })
        if (stop) return
        // 进程换了（游标比我们记的小）：重新开始
        if (r.cursor < b.cursor) Object.assign(b, fresh(key))
        append(b, r)
        setError('')
      } catch (e) {
        if (!stop) setError((e as Error).message)
      } finally {
        busy.current = false
        if (!stop) setVer((v) => v + 1)
      }
    }
    void tick()
    const id = setInterval(() => void tick(), POLL_MS)
    return () => {
      stop = true
      clearInterval(id)
    }
    // target 是每次渲染新建的对象，按进程号和世界判断就够了
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, target.world])
  return { buf: pid ? bufs.get(key) : undefined, error }
}

/** 最近 n 秒的平均（读数条显示的值）：stat unit 本身也是平滑过的，单帧跳动太大不好读 */
export function recentAvg(b: LiveBuf, col: (typeof COLS)[number], seconds = 0.5) {
  const since = Date.now() - seconds * 1000
  let sum = 0
  let n = 0
  for (let i = b.t.length - 1; i >= 0 && b.t[i] >= since; i--) {
    sum += b[col][i]
    n++
  }
  // 这半秒里一帧都没有（UE 卡在长帧、断点里）：给最后一帧的值
  if (!n) return b[col].length ? b[col][b[col].length - 1] : undefined
  return sum / n
}

/** 每秒取一个点（这一秒的平均），给读数条下面的小走势线 */
export function perSecond(b: LiveBuf, col: (typeof COLS)[number], seconds = 60) {
  const now = Date.now()
  const out: number[] = []
  let k = 0
  for (let s = seconds; s > 0; s--) {
    const lo = now - s * 1000
    const hi = lo + 1000
    let sum = 0
    let n = 0
    while (k < b.t.length && b.t[k] < hi) {
      if (b.t[k] >= lo) {
        sum += b[col][k]
        n++
      }
      k++
    }
    if (n) out.push(sum / n)
  }
  return out
}

/** 最近 seconds 秒分成 n 段，每段取平均（线程曲线）；没有帧的段沿用前一段，曲线不断 */
export function buckets(b: LiveBuf, col: (typeof COLS)[number], seconds = 60, n = 240) {
  const now = Date.now()
  const lo = now - seconds * 1000
  const size = (seconds * 1000) / n
  const sum = new Array<number>(n).fill(0)
  const cnt = new Array<number>(n).fill(0)
  for (let i = 0; i < b.t.length; i++) {
    const k = Math.floor((b.t[i] - lo) / size)
    if (k < 0 || k >= n) continue
    sum[k] += b[col][i]
    cnt[k]++
  }
  // 开头还没采到数据的段不画（刚打开页面时曲线从有数据的地方开始）
  const first = cnt.findIndex((c) => c > 0)
  if (first < 0) return []
  const out: number[] = []
  for (let k = first; k < n; k++) out.push(cnt[k] ? sum[k] / cnt[k] : (out.at(-1) ?? 0))
  // 最后一段可能还没帧（正在进行中）
  return out
}
