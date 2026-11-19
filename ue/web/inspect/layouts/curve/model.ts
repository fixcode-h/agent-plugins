import type { Prop } from '../../../details/model.ts'

/**
 * 曲线的纯逻辑（单测 curve.test.ts）：
 * - 从资源属性里找曲线：值是 FRichCurve（有 keys 数组）的属性，或这种结构的定长数组（CurveVector 的 FloatCurves[3]、
 *   CurveLinearColor 的 [4]）；不按类名分支，项目自己的曲线子类也能看；
 * - 读关键帧（引擎 JSON 转换把首字母改小写：time / interpMode / arriveTangent，两种都认）；
 * - 画法：三次段按 UE 的 Hermite（切线 × 段长 / 3 当贝塞尔控制点），线性段直线，常量段先平后竖；
 * - 取值范围、刻度。
 */
export type Interp = 'cubic' | 'linear' | 'constant'

export interface CurveKey {
  time: number
  value: number
  interp: Interp
  /** RCTM_Auto → Auto；SmartAuto、User、Break、None */
  tangentMode: string
  tangentWeightMode: string
  arrive: number
  leave: number
}

export interface Curve {
  id: string
  label: string
  /** 写回用的属性路径前缀：FloatCurve、FloatCurves[1] */
  prop: string
  tone: string
  keys: CurveKey[]
  defaultValue?: number
  pre: string
  post: string
}

function get(o: Record<string, unknown>, name: string): unknown {
  if (name in o) return o[name]
  const k = Object.keys(o).find((x) => x.toLowerCase() === name.toLowerCase())
  return k === undefined ? undefined : o[k]
}
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
/** 枚举值去掉前缀：RCIM_Cubic → Cubic、ERichCurveInterpMode::RCIM_Cubic → Cubic */
export const enumShort = (v: unknown) =>
  String(v ?? '')
    .replace(/^.*::/, '')
    .replace(/^RC[A-Z]+_/, '')

export function normInterp(v: unknown): Interp {
  const s = enumShort(v).toLowerCase()
  return s === 'linear' || s === 'constant' ? s : 'cubic'
}

const isRichCurve = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(get(v as Record<string, unknown>, 'keys'))

export function parseKeys(raw: unknown): CurveKey[] {
  if (!Array.isArray(raw)) return []
  const out: CurveKey[] = []
  for (const k of raw) {
    if (!k || typeof k !== 'object') continue
    const o = k as Record<string, unknown>
    const time = get(o, 'time')
    if (typeof time !== 'number') continue
    out.push({
      time,
      value: num(get(o, 'value')),
      interp: normInterp(get(o, 'interpMode')),
      tangentMode: enumShort(get(o, 'tangentMode')) || 'Auto',
      tangentWeightMode: enumShort(get(o, 'tangentWeightMode')) || 'None',
      arrive: num(get(o, 'arriveTangent')),
      leave: num(get(o, 'leaveTangent')),
    })
  }
  return out.sort((a, b) => a.time - b.time)
}

/** 引擎「没有默认值」用 float 最大值（3.4e38）表示：当没有 */
const realDefault = (v: unknown) => (typeof v === 'number' && Math.abs(v) < 1e30 ? v : undefined)

function curveOf(o: Record<string, unknown>, id: string, label: string, prop: string, tone: string): Curve {
  return {
    id,
    label,
    prop,
    tone,
    keys: parseKeys(get(o, 'keys')),
    defaultValue: realDefault(get(o, 'defaultValue')),
    pre: enumShort(get(o, 'preInfinityExtrap')) || 'Constant',
    post: enumShort(get(o, 'postInfinityExtrap')) || 'Constant',
  }
}

/** 定长数组的分量名和颜色：3 个是向量，4 个是颜色；颜色用主题变量（和 UE 的红绿蓝一致） */
const AXES: Record<number, { label: string; tone: string }[]> = {
  3: [
    { label: 'X', tone: 'danger' },
    { label: 'Y', tone: 'success' },
    { label: 'Z', tone: 'accent' },
  ],
  4: [
    { label: 'R', tone: 'danger' },
    { label: 'G', tone: 'success' },
    { label: 'B', tone: 'accent' },
    { label: 'A', tone: 'muted' },
  ],
}

/** 资源属性里的全部曲线（顺序照属性顺序） */
export function curvesOf(props: Prop[]): Curve[] {
  const out: Curve[] = []
  for (const p of props) {
    const v = p.value
    if (isRichCurve(v)) out.push(curveOf(v, p.name, p.displayName || p.name, p.name, 'warning'))
    else if (Array.isArray(v) && v.length && v.every(isRichCurve)) {
      const axes = AXES[v.length]
      v.forEach((c, i) =>
        out.push(
          curveOf(
            c,
            `${p.name}[${i}]`,
            axes ? axes[i].label : `${p.name}[${i}]`,
            `${p.name}[${i}]`,
            axes ? axes[i].tone : 'warning',
          ),
        ),
      )
    }
  }
  return out
}

/** 写回用的属性路径：FloatCurves[1].Keys[2].Time */
export const keyPath = (c: Curve, index: number, field: string) => `${c.prop}.Keys[${index}].${field}`

export interface Box {
  t0: number
  t1: number
  v0: number
  v1: number
}

/** 所有可见曲线的时间和值范围，四周留一成；只有一个键或全平时撑开一点，不让范围是 0 */
export function boundsOf(curves: Curve[]): Box {
  const keys = curves.flatMap((c) => c.keys)
  if (!keys.length) return { t0: -0.1, t1: 1.1, v0: -0.1, v1: 1.1 }
  let t0 = Math.min(...keys.map((k) => k.time))
  let t1 = Math.max(...keys.map((k) => k.time))
  let v0 = Math.min(...keys.map((k) => k.value))
  let v1 = Math.max(...keys.map((k) => k.value))
  if (t1 - t0 < 1e-6) {
    t0 -= 0.5
    t1 += 0.5
  }
  if (v1 - v0 < 1e-6) {
    v0 -= 0.5
    v1 += 0.5
  }
  const pt = (t1 - t0) * 0.1
  const pv = (v1 - v0) * 0.1
  return { t0: t0 - pt, t1: t1 + pt, v0: v0 - pv, v1: v1 + pv }
}

export interface Map2 {
  x: (t: number) => number
  y: (v: number) => number
}

/** 坐标换算：时间 → 横向像素，值 → 纵向像素（值大的在上） */
export function mapper(b: Box, w: number, hgt: number, pad = { l: 44, r: 20, t: 12, b: 26 }): Map2 {
  const sx = (w - pad.l - pad.r) / (b.t1 - b.t0)
  const sy = (hgt - pad.t - pad.b) / (b.v1 - b.v0)
  return { x: (t) => pad.l + (t - b.t0) * sx, y: (v) => hgt - pad.b - (v - b.v0) * sy }
}

const f = (n: number) => Math.round(n * 100) / 100

/** 第一个键到最后一个键之间的 SVG 路径（外推另外画虚线） */
export function curvePath(keys: CurveKey[], m: Map2): string {
  if (!keys.length) return ''
  let d = `M${f(m.x(keys[0].time))},${f(m.y(keys[0].value))}`
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    const x2 = f(m.x(b.time))
    const y2 = f(m.y(b.value))
    if (a.interp === 'constant') d += `H${x2}V${y2}`
    else if (a.interp === 'linear') d += `L${x2},${y2}`
    else {
      const dt = (b.time - a.time) / 3
      d += `C${f(m.x(a.time + dt))},${f(m.y(a.value + a.leave * dt))} ${f(m.x(b.time - dt))},${f(m.y(b.value - b.arrive * dt))} ${x2},${y2}`
    }
  }
  return d
}

/**
 * 选中键的切线手柄：沿切线方向在屏幕上固定长度（UE 也是固定像素长），返回到达、离开两个端点
 */
export function handles(k: CurveKey, m: Map2, len = 56) {
  const x = m.x(k.time)
  const y = m.y(k.value)
  const end = (tan: number, dir: 1 | -1) => {
    // 屏幕上的斜率：值方向的像素比例 / 时间方向的像素比例
    const dx = m.x(k.time + 1) - x
    const dy = m.y(k.value + tan) - y
    const l = Math.hypot(dx, dy) || 1
    return { x: x + (dir * dx * len) / l, y: y + (dir * dy * len) / l }
  }
  return { arrive: end(k.arrive, -1), leave: end(k.leave, 1) }
}

/** 刻度：让相邻刻度至少隔 minPx 像素，取 1、2、5 × 10^n；返回范围内的刻度值 */
export function ticks(a: number, b: number, px: number, minPx = 56): number[] {
  if (!(b > a) || !(px > 0)) return []
  const raw = ((b - a) * minPx) / px
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((x) => x * p).find((s) => s >= raw) ?? 10 * p
  const out: number[] = []
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Math.round(v / step) * step)
  return out
}

/** 刻度文字：按步长定小数位 */
export function fmtTick(v: number, all: number[]) {
  const step = all.length > 1 ? Math.abs(all[1] - all[0]) : 1
  const digits = Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)))
  return (Object.is(v, -0) ? 0 : v).toFixed(digits)
}

/** 关键帧的选中键：曲线 id + 下标 */
export const keyId = (c: string, i: number) => `${c}#${i}`
export function parseKeyId(id: string) {
  const at = id.lastIndexOf('#')
  return at < 0 ? undefined : { curve: id.slice(0, at), index: Number(id.slice(at + 1)) }
}

/** 所有可见曲线的值范围（右栏「值范围」） */
export function valueRange(curves: Curve[]) {
  const vs = curves.flatMap((c) => c.keys.map((k) => k.value))
  return vs.length ? { min: Math.min(...vs), max: Math.max(...vs) } : undefined
}

/** UE 枚举的完整值名（下拉框交给 UELink 的写法） */
export const INTERP_NAMES = ['RCIM_Cubic', 'RCIM_Linear', 'RCIM_Constant']
export const TANGENT_NAMES = ['RCTM_Auto', 'RCTM_SmartAuto', 'RCTM_User', 'RCTM_Break', 'RCTM_None']
export const WEIGHT_NAMES = ['RCTWM_WeightedNone', 'RCTWM_WeightedArrive', 'RCTWM_WeightedLeave', 'RCTWM_WeightedBoth']
export const EXTRAP_NAMES = [
  'RCCE_Cycle',
  'RCCE_CycleWithOffset',
  'RCCE_Oscillate',
  'RCCE_Linear',
  'RCCE_Constant',
  'RCCE_None',
]
