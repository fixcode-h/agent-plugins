import { t } from '../../host.ts'
import type { LuaFrames } from './lua-trace.ts'
import { fmtMs } from './parts.tsx'
import type { StatItem } from './StatsBar.tsx'
import type { Range, TraceFrames } from './trace.ts'

/** stat unit 的默认阈值（t.TargetFrameTimeThreshold / t.UnacceptableFrameTimeThreshold），trace 里读不到项目改过的值 */
export const BUDGET = { target: 33.9, unacceptable: 50 }

/** 走势线：按 60 段取最大值 */
function sparkOf(ms: ArrayLike<number>) {
  if (ms.length < 2) return []
  const n = Math.min(60, ms.length)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * ms.length) / n)
    const b = Math.max(a + 1, Math.floor(((i + 1) * ms.length) / n))
    let m = 0
    for (let k = a; k < b; k++) if (ms[k] > m) m = ms[k]
    out.push(m)
  }
  return out
}

/**
 * trace 视图的摘要读数条：帧数、平均 / P95 / 最慢、FPS、卡顿帧数、时长、线程、书签；
 * trace 含 Lua 时在 FPS 后面多四项（Lua 性能 Insights 化设计 5.6）：Lua 每帧（平均 / 最慢）、Lua 占比、Lua 调用 / 帧、Lua 内存。
 */
export function traceSummary(
  f: TraceFrames | undefined,
  duration: number,
  threads: number,
  marks: number,
  range: Range | undefined,
  lua: LuaFrames | undefined,
  onLuaWorst: () => void,
): StatItem[] {
  // 有分析范围时只算和范围有重叠的帧（一帧比范围还长时也算上它）
  const idx: number[] = []
  if (f)
    for (let i = 0; i < f.ms.length; i++)
      if (!range || (f.start[i] < range.t1 && f.start[i] + f.ms[i] / 1000 > range.t0)) idx.push(i)
  const ms = f ? idx.map((i) => f.ms[i]) : []
  const sorted = [...ms].sort((a, b) => a - b)
  const avg = ms.length ? ms.reduce((s, x) => s + x, 0) / ms.length : undefined
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : undefined
  const max = sorted.at(-1)
  const hitches = ms.filter((x) => x > BUDGET.unacceptable).length
  const lv = (v?: number) =>
    (v === undefined
      ? 'none'
      : v > BUDGET.unacceptable
        ? 'bad'
        : v > BUDGET.target
          ? 'warn'
          : 'ok') as StatItem['level']
  return [
    { key: 'avg', label: t('平均帧'), value: avg?.toFixed(1), unit: 'ms', level: lv(avg), spark: sparkOf(ms) },
    { key: 'p95', label: 'P95', value: p95?.toFixed(1), unit: 'ms', level: lv(p95) },
    { key: 'max', label: t('最慢'), value: max?.toFixed(1), unit: 'ms', level: lv(max) },
    { key: 'fps', label: 'FPS', value: avg ? (1000 / avg).toFixed(0) : undefined },
    ...(lua ? luaItems(lua, idx, ms, onLuaWorst) : []),
    {
      key: 'hitch',
      label: t('卡顿帧'),
      value: f ? String(hitches) : undefined,
      level: hitches ? 'bad' : 'ok',
      title: t('超过 {n} ms 的帧', { n: BUDGET.unacceptable }),
    },
    { key: 'frames', label: t('帧数'), value: f ? (range ? ms.length : f.total).toLocaleString() : undefined },
    range
      ? { key: 'dur', label: t('区间'), value: fmtMs((range.t1 - range.t0) * 1000) }
      : { key: 'dur', label: t('时长'), value: duration.toFixed(1), unit: 's' },
    { key: 'threads', label: t('线程'), value: String(threads) },
    { key: 'marks', label: t('书签'), value: String(marks) },
  ]
}

/** Lua 的四项：只算有读数的帧（计数器降采样后有的帧没有读数） */
function luaItems(lua: LuaFrames, idx: number[], frameMs: number[], onWorst: () => void): StatItem[] {
  const has = idx.map((i, k) => [i, k] as const).filter(([i]) => lua.ms[i] > 0 || lua.calls[i] > 0)
  const l = has.map(([i]) => lua.ms[i])
  const avg = l.length ? l.reduce((s, x) => s + x, 0) / l.length : undefined
  const max = l.length ? Math.max(...l) : undefined
  const sumF = has.reduce((s, [, k]) => s + frameMs[k], 0)
  const share = l.length && sumF ? (l.reduce((s, x) => s + x, 0) / sumF) * 100 : undefined
  const calls = has.length ? has.reduce((s, [i]) => s + lua.calls[i], 0) / has.length : undefined
  const mem = idx.map((i) => lua.memKB[i]).filter((v) => v > 0)
  const memMB = mem.length ? mem.at(-1)! / 1024 : undefined
  const grow = mem.length > 1 ? (mem.at(-1)! - mem[0]) / 1024 : undefined
  return [
    {
      key: 'lua',
      label: t('Lua 每帧'),
      value: avg?.toFixed(1),
      // 平均写成大数字、最慢跟在单位里：一格放得下，和效果图「6.4 / 25.3 ms」一致
      unit: max !== undefined ? `/ ${max.toFixed(1)} ms` : 'ms',
      wide: true,
      spark: sparkOf(idx.map((i) => lua.ms[i])),
      title: t('这一帧里所有顶层 Lua 调用的总时长：平均 / 最慢。点一下跳到 Lua 最慢的那一帧'),
      onClick: onWorst,
    },
    {
      key: 'luaShare',
      label: t('Lua 占比'),
      value: share !== undefined ? share.toFixed(0) : undefined,
      unit: '%',
      title: t('Lua 用时占帧时间的比例（录制时 Lua 会变慢一些，看相对占比）'),
    },
    {
      key: 'luaCalls',
      label: t('Lua 调用 / 帧'),
      value: calls !== undefined ? Math.round(calls).toLocaleString() : undefined,
      spark: sparkOf(idx.map((i) => lua.calls[i])),
    },
    {
      key: 'luaMem',
      label: grow !== undefined ? `${t('Lua 内存')} · ${grow >= 0 ? '+' : ''}${grow.toFixed(1)}` : t('Lua 内存'),
      value: memMB?.toFixed(1),
      unit: 'MB',
      spark: sparkOf(mem),
      title: t('lua_gc 报的内存，后面是录制期间（或分析范围内）涨了多少'),
    },
  ]
}
