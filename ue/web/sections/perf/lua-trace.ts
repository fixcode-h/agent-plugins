import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { t } from '../../host.ts'
import { shortFile } from '../lua/debug-types.ts'
import { traceQuery, type TraceBase } from './trace.ts'

/**
 * trace 视图里的 Lua 一层（Lua 性能 Insights 化设计 5.2–5.6、接口约定 9.2）：
 * Lua 函数在 trace 里就是普通的 CPU 计时器，面板靠打开 trace 时取一次的 luainfo（计时器 id → 文件、行号、是不是 C 函数）认出它们，
 * 再给时间轴配色、计时器表分组和来源列、火焰图、帧条叠加用。桥接低于 2.9.0（不认识 luainfo）就当这份 trace 没有 Lua，界面和以前一样。
 * 计时器的文件路径是桥接按字节写进 trace 的，中文路径可能乱码，显示时照原样。
 */
export interface LuaTimer {
  file: string
  line: number
  /** C 函数（UE 接口或 Lua 库），文件固定是 `<lua:C>` */
  c?: boolean
}
export interface LuaInfo extends Partial<TraceBase> {
  lua: boolean
  timers: Record<string, LuaTimer>
}

/** 三个每帧计数器（UELink 2.9.0 在 lua 通道开着时每帧结束发一次） */
export const LUA_COUNTERS = ['Lua/MemoryKB', 'Lua/FrameMs', 'Lua/Calls'] as const
export const luaCounterLabel = (name: string) =>
  name === 'Lua/MemoryKB'
    ? t('Lua 内存')
    : name === 'Lua/FrameMs'
      ? t('Lua 每帧用时')
      : name === 'Lua/Calls'
        ? t('Lua 调用数')
        : undefined

/** Lua 相关查询（luainfo、tree、timers 的 lua / mergeC）要的最低桥接版本 */
export const LUA_BRIDGE = '2.9.0'

const NONE: LuaInfo = { lua: false, timers: {} }

/** 打开 trace 时取一次 luainfo（还在录制时 rev 变了再取，新出现的 Lua 函数也认得）；查询出错（旧桥接不认识、分析失败）一律当作没有 Lua，不打扰用户 */
export function useLuaInfo(project: string, id: string, rev = -1) {
  const [info, setInfo] = useState<LuaInfo>(NONE)
  useEffect(() => setInfo(NONE), [project, id])
  useEffect(() => {
    let stop = false
    traceQuery<LuaInfo>(project, id, { what: 'luainfo' })
      .then((r) => !stop && setInfo(r?.lua && r.timers ? { lua: true, timers: r.timers } : NONE))
      .catch(() => undefined)
    return () => {
      stop = true
    }
  }, [project, id, rev])
  return info
}

/** 每帧的 Lua 读数：按帧号排好的数组（没有数据的帧是 0） */
export interface LuaFrames {
  ms: Float32Array
  calls: Float32Array
  memKB: Float32Array
}

/**
 * 读三个 Lua 计数器并按帧对齐：计数器在帧结束时发，时间点落在下一帧开头，所以按「时间点往前一点」所在的帧算。
 * 计数器查询最多 4000 个点（每段取最大值），帧更多时有的帧没有读数，记 0 —— 帧条叠加和摘要够用，尖峰不会丢。
 */
export function useLuaFrames(project: string, id: string, start: number[] | undefined, duration: number, on: boolean) {
  const [res, setRes] = useState<{ t: number[]; v: number[]; name: string }[]>()
  useEffect(() => {
    if (!on || !start?.length) return
    let stop = false
    traceQuery<TraceBase & { series: { name: string; t: number[]; v: number[] }[] }>(project, id, {
      what: 'counters',
      names: [...LUA_COUNTERS],
      t0: 0,
      t1: duration,
      px: Math.min(4000, Math.max(10, start.length * 2)),
    })
      .then((r) => !stop && setRes(r.series))
      .catch(() => undefined)
    return () => {
      stop = true
    }
  }, [project, id, on, start, duration])
  return useMemo<LuaFrames | undefined>(() => {
    if (!on || !res || !start?.length) return undefined
    const n = start.length
    const out: LuaFrames = { ms: new Float32Array(n), calls: new Float32Array(n), memKB: new Float32Array(n) }
    const dst: Record<string, Float32Array> = {
      'Lua/FrameMs': out.ms,
      'Lua/Calls': out.calls,
      'Lua/MemoryKB': out.memKB,
    }
    for (const s of res) {
      const arr = dst[s.name]
      if (!arr) continue
      for (let k = 0; k < s.t.length; k++) {
        const i = frameIndex(start, s.t[k] - 1e-6)
        if (i >= 0 && i < n) arr[i] = Math.max(arr[i], s.v[k])
      }
    }
    return out
  }, [on, res, start])
}

/** 第几帧盖住这个时间（帧按开始时间有序，二分） */
export function frameIndex(start: number[], s: number) {
  let lo = 0
  let hi = start.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (start[mid] <= s) lo = mid
    else hi = mid - 1
  }
  return lo
}

const hash = (name: string) => {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * Lua 块的颜色：固定在蓝紫一段色相（230–265），按名字哈希定深浅，一眼和 UE 块（全色相）分开；
 * C 函数更浅、饱和度更低（时间轴上再叠斜纹）。浅色主题偏亮、深色主题偏暗，块上的字两边都看得清。
 */
export function luaColor(name: string, dark: boolean, c?: boolean) {
  const h = hash(name)
  const hue = 230 + (h % 36)
  const k = ((h >>> 8) % 100) / 100
  if (c) return dark ? `hsl(${hue} 22% ${34 + k * 6}%)` : `hsl(${hue} 40% ${84 + k * 5}%)`
  return dark ? `hsl(${hue} 52% ${36 + k * 12}%)` : `hsl(${hue} 70% ${70 + k * 10}%)`
}

/** 来源一栏的文字：Lua 函数是「最后两段路径:行」，C 函数写「C · UE 接口 / Lua 库」 */
export function luaSource(name: string, x: LuaTimer | undefined) {
  if (!x) return ''
  if (x.c) return name.startsWith('lua.') ? t('C · Lua 库') : t('C · UE 接口')
  return `${shortFile(x.file)}:${x.line}`
}

/** 悬浮提示、详情里的完整来源：Script/Player/BP_PlayerController_C.lua:42 */
export function luaFullSource(x: LuaTimer | undefined) {
  if (!x || x.c) return ''
  const f = x.file.replace(/\\/g, '/')
  const i = f.indexOf('/Script/')
  return `${i >= 0 ? f.slice(i + 1) : f}:${x.line}`
}

/** 时间轴、计时器表、火焰图共用的 Lua 状态：由 TraceView 提供 */
export interface LuaTrace {
  info: LuaInfo
  /** 时间轴「只看 Lua」：非 Lua 块变淡 */
  luaOnly: boolean
  setLuaOnly: (v: boolean) => void
  /** 「C 函数并进调用者」：时间轴隐藏 C 函数块，计时器表和火焰图请求带 mergeC */
  mergeC: boolean
  setMergeC: (v: boolean) => void
  /** 打开 .lua 到某一行 */
  open: (file: string, line?: number) => void
}
const noop = () => undefined
export const LuaTraceCtx = createContext<LuaTrace>({
  info: NONE,
  luaOnly: false,
  setLuaOnly: noop,
  mergeC: false,
  setMergeC: noop,
  open: noop,
})
export const useLuaTrace = () => useContext(LuaTraceCtx)
export const luaOf = (lua: LuaTrace, id: number): LuaTimer | undefined => lua.info.timers[String(id)]
