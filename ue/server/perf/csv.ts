/**
 * CSV Profiler 抓取（Saved/Profiling/CSV/*.csv）的解析和查询。不依赖 node，纯文本处理。
 * 文件的样子：第一行是列名（Category/Stat，全局的没有前缀），之后一帧一行，EVENTS 列里是用分号隔开的事件；
 * 末尾可能再重复一遍列名，最后一行是 [Platform],Windows,[Config],Development… 这样的元数据。
 * 各引擎版本列名和末尾几行有出入，所以只按「第一行是列名、[ 开头的是元数据、和列名一样的行跳过」认，不按行号认。
 */
export interface CsvCapture {
  columns: string[]
  /** 每列一个数组，下标是帧号；EVENTS 列全是 0 */
  data: Float64Array[]
  frames: number
  /** 每帧开始时的秒数（按 FrameTime 累加）；没有 FrameTime 列时全是 0 */
  time: Float64Array
  /** 整段时长（秒） */
  seconds: number
  events: { frame: number; time: number; name: string }[]
  meta: Record<string, string>
  /** FrameTime 列的下标，没有是 -1 */
  frameCol: number
}

export interface Stat {
  avg: number
  min: number
  max: number
  p50: number
  p95: number
  p99: number
}

/** 一行按逗号拆开；带引号的字段（元数据里的命令行）里可以有逗号 */
export function splitCsvLine(line: string): string[] {
  if (!line.includes('"')) return line.split(',')
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

export function parseCsv(text: string): CsvCapture {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const header = lines[0] ?? ''
  const columns = splitCsvLine(header).map((s) => s.trim())
  if (columns.length < 2 || columns.every((c) => c === '' || !Number.isNaN(Number(c))))
    throw new Error('这不像 CSV Profiler 的文件：第一行应该是列名')
  const eventsCol = columns.findIndex((c) => c.toUpperCase() === 'EVENTS')
  const meta: Record<string, string> = {}
  const rows: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line === header) continue
    if (line.startsWith('[')) {
      const parts = splitCsvLine(line)
      for (let k = 0; k + 1 < parts.length; k += 2) {
        const key = parts[k].trim().replace(/^\[|\]$/g, '')
        if (key) meta[key] = parts[k + 1].trim()
      }
      continue
    }
    rows.push(line)
  }
  const frames = rows.length
  const data = columns.map(() => new Float64Array(frames))
  const rawEvents: { frame: number; name: string }[] = []
  for (let f = 0; f < frames; f++) {
    const cells = splitCsvLine(rows[f])
    for (let col = 0; col < columns.length && col < cells.length; col++) {
      if (col === eventsCol) {
        for (const name of cells[col].split(';')) if (name.trim()) rawEvents.push({ frame: f, name: name.trim() })
        continue
      }
      const v = Number(cells[col])
      data[col][f] = Number.isFinite(v) ? v : 0
    }
  }
  const frameCol = findColumn(columns, 'FrameTime')
  const time = new Float64Array(frames)
  let acc = 0
  if (frameCol >= 0)
    for (let f = 0; f < frames; f++) {
      time[f] = acc
      acc += data[frameCol][f] / 1000
    }
  return {
    columns,
    data,
    frames,
    time,
    seconds: acc,
    events: rawEvents.map((e) => ({ ...e, time: time[e.frame] ?? 0 })),
    meta,
    frameCol,
  }
}

/** 按名字找列：先整个名字，再不带分类的名字，都不区分大小写 */
export function findColumn(columns: string[], name: string) {
  const n = name.trim().toLowerCase()
  let i = columns.findIndex((c) => c.toLowerCase() === n)
  if (i < 0) i = columns.findIndex((c) => c.toLowerCase().split('/').pop() === n)
  return i
}

export function statOf(values: ArrayLike<number>, from = 0, to = values.length): Stat {
  const n = Math.max(0, to - from)
  if (!n) return { avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 }
  const sorted = new Float64Array(n)
  let sum = 0
  for (let i = 0; i < n; i++) {
    sorted[i] = values[from + i]
    sum += sorted[i]
  }
  sorted.sort()
  const q = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))]
  return { avg: sum / n, min: sorted[0], max: sorted[n - 1], p50: q(0.5), p95: q(0.95), p99: q(0.99) }
}

const r2 = (v: number) => Math.round(v * 100) / 100
const roundStat = (s: Stat) => ({
  avg: r2(s.avg),
  p50: r2(s.p50),
  p95: r2(s.p95),
  p99: r2(s.p99),
  max: r2(s.max),
  min: r2(s.min),
})

/** 摘要里先列的列：线程时间、内存、绘制调用。项目自己的列用 columns / column 查 */
const KEY_COLUMNS = [
  'FrameTime',
  'GameThreadTime',
  'RenderThreadTime',
  'RHIThreadTime',
  'GPUTime',
  'InputLatencyTime',
  'MemoryFreeMB',
  'PhysicalUsedMB',
  'VirtualUsedMB',
  'RHI/DrawCalls',
  'RHI/PrimitivesDrawn',
]

export function keyColumns(c: CsvCapture) {
  return KEY_COLUMNS.map((n) => findColumn(c.columns, n)).filter((i, k, a) => i >= 0 && a.indexOf(i) === k)
}

/** 秒数区间换成帧区间 [from, to) */
export function frameRange(c: CsvCapture, fromSec?: number, toSec?: number): [number, number] {
  let from = 0
  let to = c.frames
  if (fromSec !== undefined && fromSec > 0) {
    from = c.frames
    for (let f = 0; f < c.frames; f++)
      if (c.time[f] >= fromSec) {
        from = f
        break
      }
  }
  if (toSec !== undefined)
    for (let f = from; f < c.frames; f++)
      if (c.time[f] > toSec) {
        to = f
        break
      }
  return [from, Math.max(from, to)]
}

/** 卡顿的门槛：没指定时取「中位数的 2 倍」和「中位数 + 15 毫秒」里大的那个，免得 120 帧的项目把正常抖动都算进来 */
export function hitchThreshold(c: CsvCapture, thresholdMs?: number) {
  if (thresholdMs && thresholdMs > 0) return thresholdMs
  if (c.frameCol < 0) return 0
  const p50 = statOf(c.data[c.frameCol]).p50
  return Math.max(p50 * 2, p50 + 15)
}

function hitchFrames(c: CsvCapture, threshold: number, from = 0, to = c.frames) {
  const out: number[] = []
  if (c.frameCol < 0 || threshold <= 0) return out
  const ft = c.data[c.frameCol]
  for (let f = from; f < to; f++) if (ft[f] > threshold) out.push(f)
  return out
}

export function csvSummary(c: CsvCapture) {
  const threshold = hitchThreshold(c)
  const hitches = hitchFrames(c, threshold)
  const ft = c.frameCol >= 0 ? statOf(c.data[c.frameCol]) : undefined
  const cats = new Map<string, number>()
  for (const name of c.columns) {
    const cat = name.includes('/') ? name.slice(0, name.indexOf('/')) : '(全局)'
    cats.set(cat, (cats.get(cat) ?? 0) + 1)
  }
  return {
    frames: c.frames,
    seconds: r2(c.seconds),
    fps: ft && ft.avg > 0 ? { avg: r2(1000 / ft.avg), p95Low: r2(1000 / ft.p95), p99Low: r2(1000 / ft.p99) } : undefined,
    key: Object.fromEntries(keyColumns(c).map((i) => [c.columns[i], roundStat(statOf(c.data[i]))])),
    hitches: {
      thresholdMs: r2(threshold),
      count: hitches.length,
      worst: hitches
        .sort((a, b) => c.data[c.frameCol][b] - c.data[c.frameCol][a])
        .slice(0, 5)
        .map((f) => ({ frame: f, at: r2(c.time[f]), ms: r2(c.data[c.frameCol][f]) })),
    },
    events: c.events.slice(0, 40).map((e) => ({ at: r2(e.time), frame: e.frame, name: e.name })),
    eventsTotal: c.events.length,
    columns: c.columns.length,
    categories: Object.fromEntries([...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)),
    meta: pickMeta(c.meta),
    note: ft
      ? undefined
      : '这份 CSV 里没有 FrameTime 列，按时间的查询（from / to、卡顿）用不了，只能按帧号查',
  }
}

function pickMeta(meta: Record<string, string>) {
  const keep = ['Platform', 'Config', 'BuildVersion', 'EngineVersion', 'DeviceProfile', 'TargetFramerate', 'Commandline']
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(meta))
    if (keep.some((x) => x.toLowerCase() === k.toLowerCase())) out[k] = v.length > 300 ? `${v.slice(0, 300)}…` : v
  return out
}

/**
 * 一帧里「比平时涨得多」的列。各列单位不一样（毫秒、个数、MB），不能直接比差值，
 * 所以按「超出中位数多少个平时的波动幅度（P95 - P50）」排，并把这一帧的值和中位数都给出来，单位让读的人自己判断。
 */
function spikes(c: CsvCapture, frame: number, stats: Stat[], top: number) {
  const out: { column: string; value: number; median: number; score: number }[] = []
  for (let i = 0; i < c.columns.length; i++) {
    if (i === c.frameCol || c.columns[i].toUpperCase() === 'EVENTS') continue
    const s = stats[i]
    const v = c.data[i][frame]
    if (!(v > s.p50)) continue
    const spread = Math.max(s.p95 - s.p50, Math.abs(s.p50) * 0.05, 0.01)
    const score = (v - s.p50) / spread
    if (score >= 2) out.push({ column: c.columns[i], value: r2(v), median: r2(s.p50), score: r2(score) })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, top)
}

export interface CsvQuery {
  what: string
  name?: string
  frame?: number
  from?: number
  to?: number
  top?: number
  thresholdMs?: number
  offset?: number
}

export function csvQuery(c: CsvCapture, q: CsvQuery): unknown {
  const [from, to] = frameRange(c, q.from, q.to)
  const top = Math.min(Math.max(1, q.top ?? 20), 200)
  switch (q.what) {
    case 'hitches': {
      const threshold = hitchThreshold(c, q.thresholdMs)
      const frames = hitchFrames(c, threshold, from, to)
      const ft = c.data[c.frameCol]
      const stats = c.columns.map((_, i) => statOf(c.data[i]))
      const worst = [...frames].sort((a, b) => ft[b] - ft[a]).slice(0, Math.min(top, 30))
      return {
        thresholdMs: r2(threshold),
        count: frames.length,
        // 卡顿集中在哪：按 10 等分的时间段数个数，看是全程都有还是集中在某一段
        spread: buckets(c, frames, from, to, 10),
        worst: worst.map((f) => ({
          frame: f,
          at: r2(c.time[f]),
          ms: r2(ft[f]),
          events: c.events.filter((e) => Math.abs(e.frame - f) <= 2).map((e) => e.name),
          spikes: spikes(c, f, stats, 6),
        })),
        note: 'spikes 是这一帧比平时涨得最多的列（value 是这一帧的值，median 是全程中位数；各列单位不同，时间类是毫秒）',
      }
    }
    case 'columns': {
      const f = (q.name ?? '').toLowerCase()
      const all = c.columns.filter((n) => n.toUpperCase() !== 'EVENTS' && (!f || n.toLowerCase().includes(f)))
      const offset = Math.max(0, q.offset ?? 0)
      const page = all.slice(offset, offset + Math.max(top, 100))
      return {
        total: all.length,
        offset,
        items: page.map((n) => {
          const s = statOf(c.data[c.columns.indexOf(n)], from, to)
          return { name: n, avg: r2(s.avg), p95: r2(s.p95), max: r2(s.max) }
        }),
        next: offset + page.length < all.length ? offset + page.length : undefined,
      }
    }
    case 'column': {
      const i = findColumn(c.columns, q.name ?? '')
      if (i < 0) {
        const f = (q.name ?? '').toLowerCase()
        const near = c.columns.filter((n) => f && n.toLowerCase().includes(f)).slice(0, 30)
        throw new Error(
          `没有「${q.name ?? ''}」这一列${near.length ? `，名字里带它的有：${near.join('、')}` : '，用 what=columns 看有哪些列'}`,
        )
      }
      const n = Math.min(Math.max(10, q.top ?? 60), 240)
      const size = Math.max(1, Math.ceil((to - from) / n))
      const series: { at: number; avg: number; max: number }[] = []
      for (let f = from; f < to; f += size) {
        const end = Math.min(to, f + size)
        let sum = 0
        let max = -Infinity
        for (let k = f; k < end; k++) {
          sum += c.data[i][k]
          if (c.data[i][k] > max) max = c.data[i][k]
        }
        series.push({ at: r2(c.time[f]), avg: r2(sum / (end - f)), max: r2(max) })
      }
      return { column: c.columns[i], frames: to - from, stat: roundStat(statOf(c.data[i], from, to)), series }
    }
    case 'frame': {
      const f = Math.floor(q.frame ?? -1)
      if (!(f >= 0 && f < c.frames)) throw new Error(`frame 要在 0 到 ${c.frames - 1} 之间`)
      const stats = c.columns.map((_, i) => statOf(c.data[i]))
      return {
        frame: f,
        at: r2(c.time[f]),
        key: Object.fromEntries(keyColumns(c).map((i) => [c.columns[i], r2(c.data[i][f])])),
        events: c.events.filter((e) => e.frame === f).map((e) => e.name),
        spikes: spikes(c, f, stats, Math.min(top, 40)),
      }
    }
    case 'segment': {
      // 按事件（书签）切段：每个事件到下一个事件之间算一段，开头到第一个事件也算一段
      const f = (q.name ?? '').toLowerCase()
      const marks = c.events.filter((e) => !f || e.name.toLowerCase().includes(f))
      if (!marks.length)
        throw new Error(c.events.length ? `没有名字里带「${q.name}」的事件` : '这份 CSV 里没有事件（书签），没法切段')
      const cuts = [{ frame: 0, name: '(开头)' }, ...marks.map((m) => ({ frame: m.frame, name: m.name }))]
      const cols = keyColumns(c)
      const segs = cuts
        .map((cut, k) => {
          const end = k + 1 < cuts.length ? cuts[k + 1].frame : c.frames
          return { cut, end }
        })
        .filter((s) => s.end > s.cut.frame)
        .slice(0, 40)
      return {
        segments: segs.map((s) => ({
          from: s.cut.name,
          at: r2(c.time[s.cut.frame]),
          frames: s.end - s.cut.frame,
          seconds: r2((s.end < c.frames ? c.time[s.end] : c.seconds) - c.time[s.cut.frame]),
          stats: Object.fromEntries(
            cols.map((i) => {
              const st = statOf(c.data[i], s.cut.frame, s.end)
              return [c.columns[i], { avg: r2(st.avg), p95: r2(st.p95), max: r2(st.max) }]
            }),
          ),
        })),
      }
    }
    default:
      throw new Error(`CSV 抓取的 what 可以是 hitches、columns、column、frame、segment，没有「${q.what}」`)
  }
}

function buckets(c: CsvCapture, frames: number[], from: number, to: number, n: number) {
  if (to <= from) return []
  const t0 = c.time[from]
  const t1 = to < c.frames ? c.time[to] : c.seconds
  const span = Math.max(t1 - t0, 1e-6)
  const counts = new Array<number>(n).fill(0)
  for (const f of frames) counts[Math.min(n - 1, Math.floor(((c.time[f] - t0) / span) * n))]++
  return counts.map((count, k) => ({ from: r2(t0 + (span * k) / n), count }))
}

/** 两份 CSV 的差异：关键列的平均和 P95 变化，再加变化最大的若干列 */
export function csvCompare(a: CsvCapture, b: CsvCapture, top = 20) {
  const rows: { column: string; a: number; b: number; delta: number; pct: number | null; p95A: number; p95B: number }[] = []
  for (let i = 0; i < a.columns.length; i++) {
    const name = a.columns[i]
    if (name.toUpperCase() === 'EVENTS') continue
    const j = b.columns.indexOf(name)
    if (j < 0) continue
    const sa = statOf(a.data[i])
    const sb = statOf(b.data[j])
    rows.push({
      column: name,
      a: r2(sa.avg),
      b: r2(sb.avg),
      delta: r2(sb.avg - sa.avg),
      pct: sa.avg ? r2(((sb.avg - sa.avg) / Math.abs(sa.avg)) * 100) : null,
      p95A: r2(sa.p95),
      p95B: r2(sb.p95),
    })
  }
  const keys = new Set(keyColumns(a).map((i) => a.columns[i]))
  const ha = hitchFrames(a, hitchThreshold(a)).length
  const hb = hitchFrames(b, hitchThreshold(a)).length
  return {
    frames: { a: a.frames, b: b.frames },
    seconds: { a: r2(a.seconds), b: r2(b.seconds) },
    // 两边用同一个门槛（a 的）数卡顿，才比得出多了还是少了
    hitches: { thresholdMs: r2(hitchThreshold(a)), a: ha, b: hb },
    key: rows.filter((r) => keys.has(r.column)),
    // 平均值太小的列百分比没有意义，按「变化的绝对值占 a 的比例」排之前先滤掉接近 0 的
    changed: rows
      .filter((r) => !keys.has(r.column) && r.pct !== null && Math.abs(r.delta) > 0.05)
      .sort((x, y) => Math.abs(y.pct ?? 0) - Math.abs(x.pct ?? 0))
      .slice(0, Math.min(top, 60)),
    onlyInA: a.columns.filter((n) => !b.columns.includes(n)).length,
    onlyInB: b.columns.filter((n) => !a.columns.includes(n)).length,
  }
}
