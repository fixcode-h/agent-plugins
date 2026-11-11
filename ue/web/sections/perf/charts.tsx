import { h, t } from '../../host.ts'

/**
 * 性能页的小图表：都是 SVG，颜色走面板主题（ue:fill-* / ue:stroke-*），浅色深色都对。
 * 帧数据量不大（实时最多 3600 帧，文件按段聚合到 240 段），不用 canvas。
 */

export type Level = 'ok' | 'warn' | 'bad' | 'none'

/** stat unit 的配色规则：超过目标帧时间变黄，超过不可接受帧时间变红 */
export const levelOf = (ms: number | undefined, th: { target: number; unacceptable: number }): Level =>
  ms === undefined ? 'none' : ms > th.unacceptable ? 'bad' : ms > th.target ? 'warn' : 'ok'

const BAR_FILL: Record<Level, string> = {
  ok: 'ue:fill-success/70',
  warn: 'ue:fill-warning',
  bad: 'ue:fill-danger',
  none: 'ue:fill-subtle/40',
}
const STROKE: Record<Level, string> = {
  ok: 'ue:stroke-success',
  warn: 'ue:stroke-warning',
  bad: 'ue:stroke-danger',
  none: 'ue:stroke-subtle',
}

export function Spark({ values, level = 'none', className }: { values: number[]; level?: Level; className?: string }) {
  if (values.length < 2) return <svg className={className} />
  const w = 120
  const hh = 20
  const mx = Math.max(...values)
  const mn = Math.min(...values)
  const span = mx - mn || Math.max(mx, 1) * 0.1
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${hh - 1 - ((v - mn) / span) * (hh - 2)}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${hh}`} preserveAspectRatio="none" className={className} aria-hidden>
      <polyline
        points={pts}
        fill="none"
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
        className={STROKE[level]}
      />
    </svg>
  )
}

export interface Mark {
  /** 落在第几根柱（或第几个点）上 */
  index: number
  name: string
}

/**
 * 帧条：每帧一根柱。纵轴封顶在「不可接受」阈值的 1.6 倍，免得一次长卡顿把其余的压扁；阈值画虚线。
 * band：高亮一段（选中的分段），onPick：点一根柱
 */
export function FrameBars({
  values,
  th,
  marks = [],
  band,
  height = 120,
  label,
  onPick,
  picked,
}: {
  values: number[]
  th: { target: number; unacceptable: number }
  marks?: Mark[]
  band?: [number, number]
  height?: number
  label: string
  onPick?: (i: number) => void
  picked?: number
}) {
  const { cn } = h()
  const n = Math.max(values.length, 1)
  const w = 1000
  const top = Math.max(th.unacceptable * 1.6, ...values.map((v) => Math.min(v, th.unacceptable * 1.6)), 1)
  const y = (v: number) => height - 2 - (Math.min(v, top) / top) * (height - 16)
  const bw = w / n
  return (
    <div className="ue:relative">
      <svg
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        className="ue:block ue:w-full"
        style={{ height }}
        role="img"
        aria-label={label}
      >
        {band && (
          <rect
            x={band[0] * bw}
            y={0}
            width={Math.max((band[1] - band[0]) * bw, 1)}
            height={height}
            className="ue:fill-accent-soft"
          />
        )}
        {values.map((v, i) => (
          <rect
            key={i}
            x={i * bw}
            y={y(v)}
            width={Math.max(bw - (bw > 3 ? 0.8 : 0.2), 0.4)}
            height={height - 2 - y(v)}
            className={cn(
              BAR_FILL[levelOf(v, th)],
              onPick && 'ue:cursor-pointer ue:hover:opacity-70',
              picked === i && 'ue:fill-accent',
            )}
            onClick={onPick ? () => onPick(i) : undefined}
          >
            <title>{`${v.toFixed(1)} ms`}</title>
          </rect>
        ))}
        {[th.target, th.unacceptable].map((v) => (
          <line
            key={v}
            x1="0"
            x2={w}
            y1={y(v)}
            y2={y(v)}
            className="ue:stroke-line-strong"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {marks.map((m) => (
          <line
            key={`${m.index}-${m.name}`}
            x1={m.index * bw}
            x2={m.index * bw}
            y1="0"
            y2={height}
            className="ue:stroke-accent"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <ChartLabels th={th} top={top} height={height} marks={marks} count={n} />
    </div>
  )
}

/** 阈值和书签的文字标注：SVG 拉伸后文字会变形，所以文字用绝对定位的 HTML 叠在图上 */
function ChartLabels({
  th,
  top,
  height,
  marks = [],
  count,
}: {
  th?: { target: number; unacceptable: number }
  top?: number
  height: number
  marks?: Mark[]
  count: number
}) {
  const y = (v: number) => height - 2 - (Math.min(v, top ?? 1) / (top ?? 1)) * (height - 16)
  return (
    <div className="ue:pointer-events-none ue:absolute ue:inset-0 ue:overflow-hidden ue:font-mono ue:text-[10.5px] ue:text-subtle">
      {th &&
        top &&
        [th.target, th.unacceptable].map((v) => (
          <span key={v} className="ue:absolute ue:left-1.5" style={{ top: y(v) - 15 }}>
            {v.toFixed(1)} ms
          </span>
        ))}
      {marks.map((m) => (
        <span
          key={`${m.index}-${m.name}`}
          className="ue:absolute ue:top-0.5 ue:rounded-sm ue:bg-accent-soft ue:px-1 ue:font-sans ue:whitespace-nowrap ue:text-accent-text"
          style={{ left: `calc(${(m.index / Math.max(count, 1)) * 100}% + 3px)` }}
        >
          ▾ {m.name}
        </span>
      ))}
    </div>
  )
}

export interface Line {
  name: string
  values: number[]
  /** ue:stroke-* 类名 */
  stroke: string
}

/** 折线图（线程时间、内存、UObject 数）：多条线共用纵轴，网格线三条，左上角写刻度 */
export function LineChart({
  lines,
  height = 140,
  fmt,
  marks = [],
  min,
  label,
}: {
  lines: Line[]
  height?: number
  fmt: (v: number) => string
  marks?: Mark[]
  min?: number
  label: string
}) {
  const w = 1000
  const all = lines.flatMap((l) => l.values)
  const n = Math.max(...lines.map((l) => l.values.length), 2)
  if (!all.length)
    return (
      <div className="ue:flex ue:items-center ue:justify-center ue:text-footnote ue:text-subtle" style={{ height }}>
        {t('还没有数据')}
      </div>
    )
  let lo = min ?? Math.min(...all)
  let hi = Math.max(...all)
  if (hi - lo < 1e-6) {
    hi += Math.max(Math.abs(hi) * 0.05, 1)
    lo -= Math.max(Math.abs(lo) * 0.05, 1)
  }
  const pad = (hi - lo) * 0.12
  hi += pad
  if (min === undefined) lo -= pad
  const y = (v: number) => height - 4 - ((v - lo) / (hi - lo)) * (height - 22)
  const grid = [lo + (hi - lo) * 0.2, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.8]
  return (
    <div className="ue:relative">
      <svg
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        className="ue:block ue:w-full"
        style={{ height }}
        role="img"
        aria-label={label}
      >
        {grid.map((g) => (
          <line
            key={g}
            x1="0"
            x2={w}
            y1={y(g)}
            y2={y(g)}
            className="ue:stroke-line"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {marks.map((m) => (
          <line
            key={`${m.index}-${m.name}`}
            x1={(m.index / (n - 1)) * w}
            x2={(m.index / (n - 1)) * w}
            y1="0"
            y2={height}
            className="ue:stroke-accent"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {lines.map((l) => (
          <polyline
            key={l.name}
            points={l.values.map((v, i) => `${(i / (n - 1)) * w},${y(v)}`).join(' ')}
            fill="none"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
            className={l.stroke}
          />
        ))}
      </svg>
      <div className="ue:pointer-events-none ue:absolute ue:inset-0 ue:overflow-hidden ue:font-mono ue:text-[10.5px] ue:text-subtle">
        {grid.map((g) => (
          <span key={g} className="ue:absolute ue:left-1.5" style={{ top: y(g) - 15 }}>
            {fmt(g)}
          </span>
        ))}
        {marks.map((m) => (
          <span
            key={`${m.index}-${m.name}`}
            className="ue:absolute ue:top-0.5 ue:rounded-sm ue:bg-accent-soft ue:px-1 ue:font-sans ue:whitespace-nowrap ue:text-accent-text"
            style={{ left: `calc(${(m.index / (n - 1)) * 100}% + 3px)` }}
          >
            ▾ {m.name}
          </span>
        ))}
      </div>
    </div>
  )
}

/** 图例：一个色块 + 名字 + 当前值 */
export function Legend({ items }: { items: { name: string; dot: string; value?: string }[] }) {
  const { cn } = h()
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-4 ue:gap-y-1 ue:text-caption ue:text-subtle">
      {items.map((x) => (
        <span key={x.name} className="ue:inline-flex ue:items-center ue:gap-1.5">
          <span className={cn('ue:inline-block ue:h-0.5 ue:w-3 ue:rounded-full', x.dot)} />
          {x.name}
          {x.value && <span className="ue:font-mono ue:text-fg">{x.value}</span>}
        </span>
      ))}
    </div>
  )
}
