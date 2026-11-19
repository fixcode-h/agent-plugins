import type { GtStep } from '../../../../shared/gt-script/index.ts'

/**
 * 子图换种类（纯函数，单测在 subgraph-swap.test.ts）：段（group）和调用脚本（call）在界面上是同一种「子图」，
 * 检查器里选了脚本换成 call，清掉脚本换回空的 group
 */

/** 只属于某一种的字段：换种类时丢掉 */
const CALL_ONLY = ['script', 'with', 'saveAs']
const GROUP_ONLY = ['do', 'recorded', 'guards']

export const noJson = (p: string) => p.replace(/\.json$/i, '')
const omit = (s: GtStep, keys: string[]) => Object.fromEntries(Object.entries(s).filter(([k]) => !keys.includes(k)))

/** 选脚本 / 清掉脚本时换种类：id、名字、说明、失败了怎么办都留着 */
export function asSubgraph(step: GtStep, script: string): GtStep {
  if (!script) return { ...omit(step, [...CALL_ONLY, ...GROUP_ONLY]), action: 'group', do: [] } as GtStep
  // 换了脚本，参数按新脚本重填；保存返回值的变量名留着
  const base = step.action === 'call' ? step : omit(step, GROUP_ONLY)
  const same = step.action === 'call' && noJson(String(step.script ?? '')) === script
  return { ...base, action: 'call', script, ...(same ? {} : { with: {} }) } as GtStep
}
