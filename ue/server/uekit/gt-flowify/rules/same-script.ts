import { stepSig } from '../sig.ts'
import type { FlowHint, FlowRule } from '../types.ts'

/**
 * 一段连续步骤和场景根里某个现成脚本（登录、进副本、翻完引导……）一模一样：改成 call，公共流程只维护一份。
 * 现成脚本至少 3 步才比；长的先比，同一段只给一条建议。
 */
const MIN = 3

export const sameScript: FlowRule = {
  name: 'same-script',
  summary: '和现成脚本一样的一段 → call',
  run({ steps, library, claimed }) {
    const out: FlowHint[] = []
    const sigs = steps.map(stepSig)
    const libs = library
      .filter((l) => l.steps.length >= MIN && l.steps.length < steps.length)
      .map((l) => ({ rel: l.rel, sigs: l.steps.map(stepSig) }))
      .sort((a, b) => b.sigs.length - a.sigs.length)
    for (const lib of libs) {
      const n = lib.sigs.length
      for (let i = 0; i + n <= sigs.length; i++) {
        const nums = Array.from({ length: n }, (_, k) => i + k + 1)
        if (nums.some((x) => claimed.has(x))) continue
        if (!lib.sigs.every((s, k) => s === sigs[i + k])) continue
        out.push({
          rule: 'same-script',
          what: `第 ${i + 1}–${i + n} 步和现成脚本 ${lib.rel} 一模一样，改成 call`,
          steps: nums,
          changes: [{ what: `改成调用 ${lib.rel}`, op: 'replace', steps: nums, with: [{ action: 'call', script: lib.rel, note: `调用 ${lib.rel}` }] }],
        })
        nums.forEach((x) => claimed.add(x))
        i += n - 1
      }
    }
    return out
  },
}
