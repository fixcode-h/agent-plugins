import { useEffect, useRef, useState } from 'react'
import { toneColor } from '../../../sections/uekit/gt-flow/bp/parts.tsx'
import {
  boundsOf,
  curvePath,
  fmtTick,
  handles,
  keyId,
  mapper,
  ticks,
  type Curve,
  type CurveKey,
  type Map2,
} from './model.ts'

/** 量容器尺寸（曲线图按像素画，跟着分栏拖动重画） */
function useSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, ...size }
}

/** 外推的虚线：Linear 沿端点切线延长，其余（Constant、Cycle…）先按水平画（循环外推没有展开画） */
function extrap(c: Curve, m: Map2, t0: number, t1: number) {
  const first = c.keys[0]
  const last = c.keys[c.keys.length - 1]
  if (!first) return ''
  const pre = c.pre === 'Linear' ? first.value - first.arrive * (first.time - t0) : first.value
  const post = c.post === 'Linear' ? last.value + last.leave * (t1 - last.time) : last.value
  return `M${m.x(t0)},${m.y(pre)}L${m.x(first.time)},${m.y(first.value)}M${m.x(last.time)},${m.y(last.value)}L${m.x(t1)},${m.y(post)}`
}

/**
 * 曲线图（效果图 B9 中间；动画曲线轨道、Niagara 曲线以后也用它）：网格和刻度、每条曲线一种颜色、关键帧菱形、
 * 首尾外推虚线；选中的键高亮并画出到达 / 离开切线手柄，旁边写时间、值、切线。点关键帧选中
 */
export function CurveGraph({
  curves,
  picked,
  onPick,
}: {
  curves: Curve[]
  picked?: string
  onPick: (id: string) => void
}) {
  const { ref, w, h } = useSize()
  const b = boundsOf(curves)
  const m = w && h ? mapper(b, w, h) : undefined
  const tx = m ? ticks(b.t0, b.t1, w - 64) : []
  const ty = m ? ticks(b.v0, b.v1, h - 38, 40) : []
  let sel: { c: Curve; k: CurveKey } | undefined
  for (const c of curves)
    c.keys.forEach((k, i) => {
      if (keyId(c.id, i) === picked) sel = { c, k }
    })
  return (
    <div ref={ref} className="ue:relative ue:min-h-0 ue:flex-1 ue:overflow-hidden ue:bg-canvas">
      {m && (
        <svg width={w} height={h} className="ue:absolute ue:inset-0 ue:select-none" role="img">
          {tx.map((v) => (
            <g key={`x${v}`}>
              <line x1={m.x(v)} x2={m.x(v)} y1={12} y2={h - 26} className="ue:stroke-canvas-line" />
              <text
                x={m.x(v)}
                y={h - 8}
                textAnchor="middle"
                className="ue:fill-canvas-subtle ue:font-mono ue:text-[10px]"
              >
                {fmtTick(v, tx)}
              </text>
            </g>
          ))}
          {ty.map((v) => (
            <g key={`y${v}`}>
              <line x1={44} x2={w - 20} y1={m.y(v)} y2={m.y(v)} className="ue:stroke-canvas-line" />
              <text
                x={38}
                y={m.y(v) + 3}
                textAnchor="end"
                className="ue:fill-canvas-subtle ue:font-mono ue:text-[10px]"
              >
                {fmtTick(v, ty)}
              </text>
            </g>
          ))}
          {/* 0 时刻和 0 值的轴线：比网格亮一档 */}
          {b.t0 < 0 && b.t1 > 0 && (
            <line x1={m.x(0)} x2={m.x(0)} y1={12} y2={h - 26} className="ue:stroke-canvas-subtle" />
          )}
          {b.v0 < 0 && b.v1 > 0 && (
            <line x1={44} x2={w - 20} y1={m.y(0)} y2={m.y(0)} className="ue:stroke-canvas-subtle" />
          )}
          {curves.map((c) => (
            <g key={c.id} style={{ color: toneColor(c.tone) }}>
              <path
                d={extrap(c, m, b.t0, b.t1)}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                opacity={0.7}
              />
              <path d={curvePath(c.keys, m)} fill="none" stroke="currentColor" strokeWidth={2} />
            </g>
          ))}
          {sel && <Handles k={sel.k} m={m} />}
          {curves.map((c) =>
            c.keys.map((k, i) => {
              const id = keyId(c.id, i)
              const on = id === picked
              return (
                <rect
                  key={id}
                  role="button"
                  aria-label={`${c.label} ${k.time} ${k.value}`}
                  x={m.x(k.time) - 5}
                  y={m.y(k.value) - 5}
                  width={10}
                  height={10}
                  transform={`rotate(45 ${m.x(k.time)} ${m.y(k.value)})`}
                  onClick={() => onPick(id)}
                  className="ue:cursor-pointer ue:stroke-canvas ue:stroke-1"
                  style={{ fill: on ? 'var(--accent)' : toneColor(c.tone) }}
                />
              )
            }),
          )}
        </svg>
      )}
      {m && sel && <KeyTip k={sel.k} m={m} w={w} />}
    </div>
  )
}

function Handles({ k, m }: { k: CurveKey; m: Map2 }) {
  if (k.interp !== 'cubic') return null
  const { arrive, leave } = handles(k, m)
  return (
    <g className="ue:stroke-canvas-strong">
      <line x1={arrive.x} y1={arrive.y} x2={leave.x} y2={leave.y} strokeWidth={1} />
      {[arrive, leave].map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} className="ue:fill-canvas" strokeWidth={1.5} />
      ))}
    </g>
  )
}

/** 选中键旁边的小标签：t · v，切线 */
function KeyTip({ k, m, w }: { k: CurveKey; m: Map2; w: number }) {
  const x = m.x(k.time)
  const left = x + 16 + 170 > w ? x - 186 : x + 16
  return (
    <div
      className="ue:pointer-events-none ue:absolute ue:rounded-md ue:border ue:border-canvas-line ue:bg-canvas-bar ue:px-2 ue:py-1 ue:font-mono ue:text-caption ue:text-canvas-fg"
      style={{ left, top: m.y(k.value) + 12 }}
    >
      <div>{`t ${k.time.toFixed(3)} · v ${k.value.toFixed(3)}`}</div>
      {k.interp === 'cubic' && (
        <div className="ue:text-canvas-subtle">{`Arrive ${k.arrive.toFixed(2)} · Leave ${k.leave.toFixed(2)}`}</div>
      )}
    </div>
  )
}
