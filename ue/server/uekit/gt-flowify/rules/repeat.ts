import { range, screenOf, stepSig } from '../sig.ts'
import type { FlowHint, FlowRule } from '../types.ts'

/**
 * 连着做了 3 次以上一模一样的操作（连点「下一页」、连按 E 跳对话）：录到的次数只是那一次碰巧的次数，
 * 改成循环更稳。下一步有界面目标时「做到下一步要点的东西出现为止」，max 给录到次数的 3 倍；没有就按次数循环。
 */
const SKIP = new Set(['wait', 'mark', 'snapshot', 'screenshot', 'ping', 'probe'])
const MIN = 3

export const repeat: FlowRule = {
  name: 'repeat',
  summary: '连着重复 3 次以上的同一操作 → 循环',
  run({ steps, claimed }) {
    const out: FlowHint[] = []
    let i = 0
    while (i < steps.length) {
      const sig = stepSig(steps[i])
      let j = i + 1
      while (j < steps.length && stepSig(steps[j]) === sig) j++
      const n = j - i
      const nums = range(i + 1, j)
      const action = String(steps[i].action ?? '')
      if (n >= MIN && !SKIP.has(action) && !nums.some((x) => claimed.has(x))) {
        const next = steps[j]
        const until = next && screenOf(next.target) ? { target: next.target, visible: true } : undefined
        const block = until
          ? { action: 'loop', until, max: Math.max(n * 3, 10), note: `重复到下一步的目标出现为止（录制时是 ${n} 次）` }
          : { action: 'loop', times: n, note: `录制时重复了 ${n} 次` }
        const label = String(steps[i].target ?? steps[i].key ?? action)
        out.push({
          rule: 'repeat',
          what: until
            ? `第 ${i + 1}–${j} 步连着 ${n} 次 ${label}，改成循环：做到下一步的 ${String(next.target)} 出现为止（最多 ${block.max} 轮）`
            : `第 ${i + 1}–${j} 步连着 ${n} 次 ${label}，改成循环 ${n} 次`,
          steps: nums,
          changes: [
            { what: `重复的第 ${i + 2}–${j} 步并进循环`, op: 'delete', steps: nums.slice(1) },
            { what: '第一次包成循环', op: 'wrap', steps: [i + 1], block },
          ],
        })
        nums.forEach((x) => claimed.add(x))
      }
      i = j
    }
    return out
  },
}
