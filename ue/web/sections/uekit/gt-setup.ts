import { t } from '../../host.ts'

/**
 * GameTest 1.2.5 运行配置里的前置步骤（setup）和随机种子（randomSeed）：设置弹窗里用文本编辑，保存前在这里校验。
 * 前置步骤只查是不是对象数组、每条有 action；字段对不对由 GameTest 开跑时按场景步骤同一套规则查
 */
export function parseSetup(text: string): { steps?: Record<string, unknown>[]; error?: string } {
  if (!text.trim()) return { steps: [] }
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch (e) {
    return { error: t('前置步骤不是合法的 JSON：{e}', { e: (e as Error).message }) }
  }
  if (!Array.isArray(v)) return { error: t('前置步骤要写成数组：[ {"action": ...}, ... ]') }
  const bad = v.findIndex(
    (s) => !s || typeof s !== 'object' || Array.isArray(s) || typeof s.action !== 'string' || !s.action,
  )
  if (bad >= 0) return { error: t('前置步骤第 {n} 条要是对象并且有 action', { n: bad + 1 }) }
  return { steps: v as Record<string, unknown>[] }
}

export function parseSeed(text: string): { seed?: number; error?: string } {
  if (!text.trim()) return {}
  const n = Number(text)
  return Number.isInteger(n) ? { seed: n } : { error: t('随机种子要填整数，不固定就空着') }
}

export const setupText = (steps?: unknown[]) => (steps?.length ? JSON.stringify(steps, null, 2) : '')

/** 前置步骤的示例：清引导、重置每日奖励这类 GM，换成项目自己的指令 */
export const SETUP_PLACEHOLDER = '[\n  { "action": "console", "command": "gm.ResetGuide" }\n]'
