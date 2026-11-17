/**
 * trace 的时间换成「从录制开始算」：TraceServices 给的时间从被测进程启动算，
 * 面板在编辑器开了很久之后才 Trace.File，第一帧就在几百上千秒处（网页曾显示「已分析到第 1700 秒」，其实只录了 31 秒）。
 * 桥接 2.8.1 起每个回包带 origin（第一帧的开始时间），这里统一把请求里的时间加上它、回包里的时间减掉它，
 * 网页和 Agent 看到的都是从 0 开始的秒数。旧桥接没有 origin，按 0 处理，和以前一样。
 */

/** 请求里表示时间点的参数 */
const ARG_TIMES = ['t0', 't1', 'time'] as const

export function shiftArgs(args: Record<string, unknown>, origin: number): Record<string, unknown> {
  if (!origin) return args
  const out = { ...args }
  for (const k of ARG_TIMES) {
    const v = out[k]
    if (v === undefined || v === null || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) out[k] = n + origin
  }
  return out
}

const sub = (xs: unknown, o: number) => (Array.isArray(xs) ? xs.map((x) => (typeof x === 'number' ? x - o : x)) : xs)
const subField = (items: unknown, key: string, o: number) =>
  Array.isArray(items)
    ? items.map((x) =>
        x && typeof x === 'object' && typeof (x as Record<string, unknown>)[key] === 'number'
          ? { ...x, [key]: ((x as Record<string, unknown>)[key] as number) - o }
          : x,
      )
    : items

/** 回包里的时间按 what 各自的字段减掉 origin（字段见桥接 AgentPanelTrace.cpp） */
export function shiftResult(what: string, res: Record<string, unknown>, origin: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...res }
  if (typeof out.duration === 'number') out.duration = Math.max(0, out.duration - origin)
  if (!origin) return out
  switch (what) {
    case 'frames':
      out.start = sub(out.start, origin)
      break
    case 'timing':
      if (Array.isArray(out.lanes))
        out.lanes = out.lanes.map((l: Record<string, unknown>) => ({ ...l, s: sub(l.s, origin) }))
      break
    case 'stack':
      out.stack = subField(out.stack, 'start', origin)
      break
    case 'instances':
      out.items = subField(out.items, 'start', origin)
      break
    case 'bookmarks':
    case 'log':
      out.items = subField(out.items, 't', origin)
      break
    case 'counters':
      if (Array.isArray(out.series))
        out.series = out.series.map((s: Record<string, unknown>) => ({ ...s, t: sub(s.t, origin) }))
      break
  }
  return out
}
