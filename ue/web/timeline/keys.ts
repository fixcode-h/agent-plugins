/**
 * 动画时间轴的纯逻辑（共用组件 Timeline 用；UMG 动画第一期，以后动画序列也用）：
 * - 读关键帧：对象写法 { time, value, interp } 和简写 [time, value, interp?] 都认（设计稿 4.2 第 2 条）；
 * - 求某一时刻的值（常量取前一个键，线性插值，cubic 按零切线的三次曲线近似 UE 的 Auto 切线）；
 * - 刻度间隔、时间格式。
 * 单测在 timeline.test.ts。
 */
export type Interp = 'cubic' | 'linear' | 'constant'

export interface AnimKey {
  time: number
  value: unknown
  interp: Interp
}

export interface AnimTrack {
  /** 控件路径（从根起的名字，Root/Shell/Main），UE 回的也可能只有控件名 */
  target: string
  /** 通道：RenderOpacity、RenderTransform.Translation.X、slot.Padding.Left… */
  channel: string
  keys: AnimKey[]
}

export interface Anim {
  name: string
  /** 长度（秒）：给了用给的，没给按最后一个键 */
  length: number
  tracks: AnimTrack[]
  /** 读不出来跳过的轨道（umg.anims 每段动画里的 skipped：不在通道白名单里的属性轨、事件轨…），写成一句给人看 */
  skipped?: string
}

/** skipped 可能是个数、名字列表或对象列表：都写成一行 */
function skippedText(v: unknown): string | undefined {
  if (typeof v === 'number') return v > 0 ? String(v) : undefined
  if (typeof v === 'string') return v || undefined
  if (Array.isArray(v) && v.length)
    return v
      .map((x) =>
        x && typeof x === 'object'
          ? Object.values(x as Record<string, unknown>)
              .filter((y) => typeof y === 'string')
              .join(' ')
          : String(x),
      )
      .join('、')
  return undefined
}

const INTERPS: Interp[] = ['cubic', 'linear', 'constant']
/** 插值写法统一：UE 回的 RCIM_Linear、Linear 这类也认；没写是 cubic（AssetForge 默认） */
export function normInterp(v: unknown): Interp {
  const s = String(v ?? '')
    .replace(/^RCIM_/i, '')
    .toLowerCase()
  return (INTERPS as string[]).includes(s) ? (s as Interp) : 'cubic'
}

/** 一个关键帧：对象写法或数组简写；时间不是数字的丢掉 */
export function parseKey(k: unknown): AnimKey | undefined {
  if (Array.isArray(k)) {
    const [time, value, interp] = k as unknown[]
    return typeof time === 'number' && Number.isFinite(time) ? { time, value, interp: normInterp(interp) } : undefined
  }
  if (k && typeof k === 'object') {
    const o = k as Record<string, unknown>
    const time = Number(o.time ?? o.t)
    return Number.isFinite(time) ? { time, value: o.value ?? o.v, interp: normInterp(o.interp) } : undefined
  }
  return undefined
}

/** 配置里的 animations 段、umg.anims 回的 animations：读不懂的条目跳过，不报错（预览而已） */
export function parseAnims(raw: unknown): Anim[] {
  if (!Array.isArray(raw)) return []
  const out: Anim[] = []
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const o = a as Record<string, unknown>
    const tracks: AnimTrack[] = []
    for (const t of Array.isArray(o.tracks) ? o.tracks : []) {
      if (!t || typeof t !== 'object') continue
      const tr = t as Record<string, unknown>
      const keys = (Array.isArray(tr.keys) ? tr.keys : [])
        .map(parseKey)
        .filter((k): k is AnimKey => !!k)
        .sort((x, y) => x.time - y.time)
      tracks.push({ target: String(tr.target ?? ''), channel: String(tr.channel ?? ''), keys })
    }
    const end = Math.max(0, ...tracks.flatMap((t) => t.keys.map((k) => k.time)))
    const len = Number(o.length)
    const skipped = skippedText(o.skipped)
    out.push({
      name: String(o.name ?? `Anim_${out.length}`),
      length: Number.isFinite(len) && len > 0 ? len : end,
      tracks,
      ...(skipped ? { skipped } : {}),
    })
  }
  return out
}

/**
 * 某一时刻的值：第一个键之前取第一个、最后一个之后取最后一个；中间按左边那个键的插值方式。
 * 不是数字的值（颜色、可见性）按常量处理
 */
export function valueAt(keys: AnimKey[], time: number): unknown {
  if (!keys.length) return undefined
  if (time <= keys[0].time) return keys[0].value
  const lastKey = keys[keys.length - 1]
  if (time >= lastKey.time) return lastKey.value
  let i = 0
  while (i < keys.length - 1 && keys[i + 1].time <= time) i++
  const a = keys[i]
  const b = keys[i + 1]
  if (a.interp === 'constant' || typeof a.value !== 'number' || typeof b.value !== 'number') return a.value
  const span = b.time - a.time
  const u = span > 0 ? (time - a.time) / span : 1
  const w = a.interp === 'linear' ? u : u * u * (3 - 2 * u)
  return a.value + (b.value - a.value) * w
}

/** 一段动画在某时刻各轨道的值：target → channel → 值 */
export function sampleAnim(anim: Anim | undefined, time: number) {
  const out = new Map<string, Record<string, unknown>>()
  for (const t of anim?.tracks ?? []) {
    const v = valueAt(t.keys, time)
    if (v === undefined) continue
    out.set(t.target, { ...out.get(t.target), [t.channel]: v })
  }
  return out
}

/** 刻度间隔（秒）：让相邻刻度至少隔 minPx 像素，取 1、2、5 × 10^n */
export function tickStep(length: number, widthPx: number, minPx = 64) {
  if (!(length > 0) || !(widthPx > 0)) return 1
  const raw = (length * minPx) / widthPx
  const p = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p
  return 10 * p
}

/** 时间显示：0.50s；步长细时多一位 */
export const fmtSec = (s: number, digits = 2) => `${s.toFixed(digits)}s`

/** 通道 → 细节面板里的顶层属性名（被动画驱动的属性打标记）：slot.Padding.Left → Slot.Padding 和 Slot */
export function channelProps(channel: string): string[] {
  const parts = channel.split('.')
  if (parts[0].toLowerCase() === 'slot') return parts[1] ? [`Slot.${parts[1]}`, 'Slot'] : ['Slot']
  return [parts[0]]
}

/** 值写成一行：数字最多三位小数 */
export function fmtValue(v: unknown): string {
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000)
  if (v === undefined || v === null) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}
