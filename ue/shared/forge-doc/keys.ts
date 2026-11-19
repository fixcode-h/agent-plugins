/**
 * AssetForge 配置里 UMG 动画关键帧的两种写法（设计稿 4.2「关键帧简写」）：
 * 对象 `{ "time": 0.3, "value": 0.85, "interp": "cubic" }` 和简写 `[0.3, 0.85, "cubic"]` / `[0.3, 0.85]` 等价。
 * UEKit 导出写简写，手写的旧配置是对象：网页里读动画的地方都先过这里，后面只认对象一种。
 * interp 省略时不补默认值（UE 那边默认 cubic），显示时照写的来，免得把没写的显示成写了。
 */
export interface ForgeKey {
  time: number
  value: number
  interp?: string
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** 一个关键帧 → 对象写法；认不出的返回 undefined（调用方跳过，不让一个坏帧拖垮整条轨道的显示） */
export function normalizeKey(k: unknown): ForgeKey | undefined {
  if (Array.isArray(k)) {
    const time = num(k[0])
    const value = num(k[1])
    if (time === undefined || value === undefined) return undefined
    return typeof k[2] === 'string' && k[2] ? { time, value, interp: k[2] } : { time, value }
  }
  if (!k || typeof k !== 'object') return undefined
  const o = k as Record<string, unknown>
  const time = num(o.time)
  const value = num(o.value)
  if (time === undefined || value === undefined) return undefined
  return typeof o.interp === 'string' && o.interp ? { time, value, interp: o.interp } : { time, value }
}

export interface ForgeTrack {
  target: string
  channel: string
  keys: ForgeKey[]
}

export interface ForgeAnimation {
  name: string
  tracks: ForgeTrack[]
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** 顶层 animations → 统一成对象写法的关键帧；不是数组时回空数组 */
export function normalizeAnimations(anims: unknown): ForgeAnimation[] {
  if (!Array.isArray(anims)) return []
  return anims
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && !Array.isArray(a))
    .map((a) => ({
      name: str(a.name),
      tracks: (Array.isArray(a.tracks) ? a.tracks : [])
        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && !Array.isArray(t))
        .map((t) => ({
          target: str(t.target),
          channel: str(t.channel),
          keys: (Array.isArray(t.keys) ? t.keys : []).map(normalizeKey).filter((k): k is ForgeKey => !!k),
        })),
    }))
}
