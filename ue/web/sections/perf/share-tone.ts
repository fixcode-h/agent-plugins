import { h } from '../../host.ts'

/**
 * 占比配色（用户 2026-11-17：调用者 / 被调用者树每行的占比底条太淡、看不出轻重）：按「占根 %」分四档，
 * 低于 low 很淡的中性色，low–mid 强调色，mid–high 警告色，high 以上危险色。颜色都是主题变量，
 * 用 color-mix 调透明度，深浅色主题下都清楚、文字照样能读。调用树和火焰图格子共用这一处定义。
 * 阈值和强度是插件参数（设置 → 插件参数 → UE →「性能：占比配色」），没设时用默认值。
 */
export interface ShareTone {
  /** 档位分界（百分比，0–100，从小到大） */
  low: number
  mid: number
  high: number
  /** 强度倍数：1 = 默认，0.5 更淡，2 更浓 */
  strength: number
}

export const SHARE_TONE_DEFAULT: ShareTone = { low: 5, mid: 20, high: 50, strength: 1 }

/** 每档的主题色和默认不透明度（%）：中性档最淡；越热越浓，但最浓也只是底色，不盖住文字 */
const TIERS = [
  { color: 'var(--subtle)', mix: 10 },
  { color: 'var(--accent)', mix: 16 },
  { color: 'var(--warning)', mix: 20 },
  { color: 'var(--danger)', mix: 22 },
] as const

const num = (v: unknown, def: number, lo: number, hi: number) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def
}

/** 读插件参数；读不到（设置里的组件示例、旧面板）用默认值 */
export function shareTone(): ShareTone {
  let c: Record<string, unknown> = {}
  try {
    c = h().config() ?? {}
  } catch {
    c = {}
  }
  const d = SHARE_TONE_DEFAULT
  const low = num(c.perfShareLow, d.low, 0, 100)
  const mid = Math.max(low, num(c.perfShareMid, d.mid, 0, 100))
  const high = Math.max(mid, num(c.perfShareHigh, d.high, 0, 100))
  return { low, mid, high, strength: num(c.perfShareStrength, 100, 25, 300) / 100 }
}

/** 第几档：0 中性、1 强调、2 警告、3 危险 */
export function shareTier(pct: number, tone: ShareTone = SHARE_TONE_DEFAULT) {
  return pct >= tone.high ? 3 : pct >= tone.mid ? 2 : pct >= tone.low ? 1 : 0
}

/** 底条 / 格子的背景色（CSS 颜色串，直接放进 style.background） */
export function shareColor(pct: number, tone: ShareTone = SHARE_TONE_DEFAULT) {
  const tier = TIERS[shareTier(pct, tone)]
  const mix = Math.min(60, Math.round(tier.mix * tone.strength))
  return `color-mix(in oklab, ${tier.color} ${mix}%, transparent)`
}
