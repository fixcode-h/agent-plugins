/**
 * 资源预览（UELink 2.18 的 asset.preview，设计稿第 5 节）和预览类布局共用的纯逻辑：
 * 视角怎么随拖动 / 滚轮变、请求的图多大、能力怎么判断、资源注册表标签怎么挑成一排统计。
 * 不带 React，单测（preview.test.ts）直接 import。
 */

/** asset.preview 的视角：照 UE 缩略图的轨道相机，没给的分量 UE 用资源自己的缩略图设置 */
export interface PreviewView {
  yaw: number
  pitch: number
  /** 在自动取景距离上加的偏移（0 刚好装下包围球，正数更远） */
  distance: number
}

/** asset.preview 的回包（kind 是 UE 认出的类型；mode 目前固定 thumbnail） */
export interface PreviewShot {
  file: string
  width: number
  height: number
  kind: string
  mode: string
  ms: number
  note?: string
}

/** UE 缩略图的默认视角（资源没有自己的缩略图设置时）：用户点「重置视角」回到这里 */
export const DEFAULT_VIEW: PreviewView = { yaw: -157.5, pitch: -11.25, distance: 0 }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * 拖动改视角：左右拖转 yaw（一像素半度），上下拖转 pitch（往下拖从上往下看，pitch 变负），pitch 限在 -89–89
 * （UE 允许 -90–90，正好 ±90 时相机朝向退化，留一度）。yaw 折回 -180–180，数字不会越滚越大
 */
export function orbit(v: PreviewView, dx: number, dy: number): PreviewView {
  let yaw = v.yaw + dx * 0.5
  yaw = ((((yaw + 180) % 360) + 360) % 360) - 180
  return { ...v, yaw: round1(yaw), pitch: round1(clamp(v.pitch - dy * 0.4, -89, 89)) }
}

/**
 * 滚轮改距离：往前滚拉近、往后滚推远。距离是加在自动取景上的世界单位偏移，资源大小不知道，
 * 所以一格按 25 单位走、不允许比自动取景近太多（-150），推远到 5000 为止
 */
export function dolly(v: PreviewView, deltaY: number): PreviewView {
  const step = deltaY > 0 ? 25 : deltaY < 0 ? -25 : 0
  return { ...v, distance: clamp(v.distance + step, -150, 5000) }
}

/** 视角是不是默认的（页头的「重置视角」只在改过时亮） */
export const isDefaultView = (v: PreviewView) =>
  v.yaw === DEFAULT_VIEW.yaw && v.pitch === DEFAULT_VIEW.pitch && v.distance === DEFAULT_VIEW.distance

/**
 * 请求多大的图：按显示区域的物理像素取，往上取到 64 的倍数（拖分栏时小变化不重新请求），
 * 限在 UELink 允许的 16–2048，再限到 max（缩略图渲染越大越慢，三维的默认最多 1024）
 */
export function reqSize(cssPx: number, dpr = 1, max = 1024): number {
  const px = Math.ceil((Math.max(0, cssPx) * Math.max(1, dpr)) / 64) * 64
  return clamp(px || 256, 64, Math.min(2048, max))
}

/**
 * 节流：上一次请求发出后至少隔 gap 毫秒再发（拖视角时每帧都在变，UE 一次几十到几百毫秒）。
 * 返回还要等多久，0 是马上发
 */
export function waitFor(lastAt: number, now: number, gap = 120): number {
  return Math.max(0, lastAt + gap - now)
}

/** 进程的能力：操作名在 /info 的 ops 里（asset.preview），或者能力名在名片的 features 里（bp.layout） */
export function hasCap(inst: { online?: boolean; ops?: string[]; features?: string[] } | undefined, name: string) {
  return !!inst?.online && (!!inst.ops?.includes(name) || !!inst.features?.includes(name))
}

/** 「这个进程不支持 asset.preview」这类：桥接旧，按不支持处理（界面降级，不当错误） */
export const oldBridge = (msg: string, op: string) => msg.startsWith(`这个进程不支持 ${op}`)

/** 一项统计：标签（显示名）+ 值（已经整理好） */
export interface Stat {
  key: string
  label: string
  value: string
}

/** 统计里认的注册表标签：[标签名（UE 的 AssetRegistrySearchable 名字，大小写不敏感）, 显示名] */
export type StatSpec = [string, string][]

/** 注册表标签值的整理：数字加千分位、布尔写成 开 / 关、ApproxSize 的 100x100x100 写成 100 × 100 × 100 */
export function tidyTag(v: string, on = 'On', off = 'Off'): string {
  const s = v.trim()
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s) ? on : off
  if (/^-?\d+$/.test(s) && s.length > 3) return Number(s).toLocaleString('en-US')
  if (/^\d+(\.\d+)?x\d+(\.\d+)?(x\d+(\.\d+)?)?$/i.test(s)) return s.split(/x/i).join(' × ')
  return s
}

/** 按 spec 的顺序挑出资源有的标签（没有的跳过，不显示空值） */
export function pickStats(tags: Record<string, string> | undefined, spec: StatSpec, on?: string, off?: string): Stat[] {
  if (!tags) return []
  const lower = new Map(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), { k, v }]))
  const out: Stat[] = []
  for (const [name, label] of spec) {
    const hit = lower.get(name.toLowerCase())
    if (hit && hit.v !== '') out.push({ key: hit.k, label, value: tidyTag(hit.v, on, off) })
  }
  return out
}

/** 标签里没被 spec 挑走的那些（资源信息里列出来，不丢） */
export function restTags(tags: Record<string, string> | undefined, spec: StatSpec): [string, string][] {
  if (!tags) return []
  const used = new Set(spec.map(([k]) => k.toLowerCase()))
  return Object.entries(tags)
    .filter(([k, v]) => !used.has(k.toLowerCase()) && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
}

/** 对象路径的短名：/Game/A/M_X.M_X → M_X，/Game/M.M:MaterialExpressionConstant_0 → MaterialExpressionConstant_0 */
export const shortName = (p: string) => p.split(/[./:]/).pop() || p

/** 注册表标签里的对象引用常写成 Class'/Game/A/B.B'：取出路径；不是就原样 */
export function refPath(v: unknown): string {
  if (typeof v !== 'string') return ''
  const m = /^[\w.]*'(.*)'$/.exec(v.trim())
  return (m ? m[1] : v.trim()).replace(/^"|"$/g, '')
}
