import { useEffect, useRef, useState } from 'react'
import { ppost } from '../../api.ts'

/**
 * trace 视图的数据：都走 perf/trace（服务端转给编辑器 / 后台编辑器里的 TraceServices，见 server/trace-query.ts）。
 * 时间都是相对 trace 开头的秒数，耗时是毫秒。
 */
export interface TraceBase {
  analyzing: boolean
  duration: number
}
export interface Lane {
  id: number
  name: string
  group: string
}
export interface TraceInfo extends TraceBase {
  threads: Lane[]
  frames: number
}
export interface TraceFrames extends TraceBase {
  start: number[]
  ms: number[]
  total: number
}
export interface LaneBlocks {
  id: number
  s: number[]
  ms: number[]
  d: number[]
  t: number[]
  /** 独占时间（毫秒）：桥接 1.5.0 起有 */
  x?: number[]
  hidden: number
}
export interface Timing extends TraceBase {
  lanes: LaneBlocks[]
  names: Record<string, string>
  cut: boolean
}
export interface TimerRow {
  id: number
  name: string
  count: number
  incl: number
  inclMax: number
  excl: number
  gpu?: boolean
}
export interface StackRow {
  id: number
  name: string
  start: number
  ms: number
  excl: number
  depth: number
}
export interface StackRes extends TraceBase {
  stack: StackRow[]
  children: { id: number; name: string; count: number; incl: number; inclMax: number }[]
  selected?: number
}
/** 一个计时器在范围内每一次调用的统计和最慢的几次（桥接 1.5.0 的 instances） */
export interface Instances extends TraceBase {
  id: number
  name: string
  count: number
  incl: number
  excl: number
  min: number
  max: number
  avg: number
  median: number
  items: { lane: number; start: number; ms: number; excl: number; depth: number }[]
}
export interface Bookmark {
  t: number
  text: string
}
export interface Range {
  t0: number
  t1: number
}
/** 时间轴上点中的一块 */
export interface PickedBlock {
  lane: number
  time: number
  depth: number
  timer: number
  ms: number
  name: string
  /** 独占时间（毫秒），桥接旧时没有 */
  excl?: number
}

export const traceQuery = <T>(project: string, id: string, args: Record<string, unknown>) =>
  ppost<T>(project, 'perf/trace', { id, ...args })

/**
 * 分析状态：第一次查要等编辑器 / 后台编辑器分析（几秒到几十秒，后台编辑器没起来还要先启动），
 * analyzing 时每 1.5 秒再问一次，分析完停。
 */
export function useTraceInfo(project: string, id: string) {
  const [info, setInfo] = useState<TraceInfo>()
  const [error, setError] = useState('')
  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const r = await traceQuery<TraceInfo>(project, id, { what: 'info' })
        if (stop) return
        setInfo(r)
        setError('')
        if (r.analyzing) timer = setTimeout(tick, 1500)
      } catch (e) {
        if (!stop) setError((e as Error).message)
      }
    }
    void tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [project, id])
  return { info, error, ready: !!info && !info.analyzing }
}

/** 延迟一点再取（拖动、滚轮缩放时不每一帧都发请求），只认最后一次的结果 */
export function useDebounced<T>(load: (() => Promise<T>) | undefined, key: string, ms = 120) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)
  const fn = useRef(load)
  fn.current = load
  useEffect(() => {
    if (!fn.current) return
    const my = ++seq.current
    setLoading(true)
    const timer = setTimeout(() => {
      fn.current?.()
        .then((d) => {
          if (my !== seq.current) return
          setData(d)
          setError('')
        })
        .catch((e: Error) => my === seq.current && setError(e.message))
        .finally(() => my === seq.current && setLoading(false))
    }, ms)
    return () => clearTimeout(timer)
  }, [key, ms])
  return { data, error, loading }
}

/** 泳道顺序照 Insights：GPU → GameThread → RenderThread → RHIThread → 其他（工作线程默认折叠） */
export function orderLanes(threads: Lane[]) {
  const rank = (l: Lane) => {
    if (l.id === -1) return 0
    const n = l.name.toLowerCase()
    if (n === 'gamethread') return 1
    if (n.startsWith('renderthread') || n === 'rendering thread') return 2
    if (n.startsWith('rhithread') || n === 'rhi thread') return 3
    return 10
  }
  const sorted = [...threads].sort((a, b) => rank(a) - rank(b))
  return { main: sorted.filter((l) => rank(l) < 10), workers: sorted.filter((l) => rank(l) >= 10) }
}

/** 块的颜色按名字哈希：同一个函数在哪都是同一个颜色（Insights 的做法），浅色深色各一套亮度 */
export function blockColor(name: string, dark: boolean) {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  const hue = (h >>> 0) % 360
  return dark ? `hsl(${hue} 42% 38%)` : `hsl(${hue} 58% 74%)`
}
