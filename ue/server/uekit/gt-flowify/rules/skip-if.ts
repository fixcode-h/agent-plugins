import type { FlowHint, FlowRule } from '../types.ts'

/**
 * 连着几步写了同一个 skipIf（录制时「这个界面在就跳过」一步一步加的）：其实是一段「如果……就做」，
 * 包成 if，条件取反，步骤上的 skipIf 去掉，读起来就是一个分支。
 */
const MIN = 2

export const skipIf: FlowRule = {
  name: 'skip-if',
  summary: '连着几步同一个 skipIf → 如果',
  run({ steps, claimed }) {
    const out: FlowHint[] = []
    let i = 0
    while (i < steps.length) {
      const cond = steps[i].skipIf
      const key = cond === undefined ? '' : JSON.stringify(cond)
      let j = i + 1
      while (key && j < steps.length && JSON.stringify(steps[j].skipIf) === key) j++
      const nums = Array.from({ length: j - i }, (_, k) => i + k + 1)
      if (key && j - i >= MIN && !nums.some((n) => claimed.has(n))) {
        out.push({
          rule: 'skip-if',
          what: `第 ${i + 1}–${j} 步都写了同一个 skipIf，合成一个「如果」分支（条件取反），步骤上的 skipIf 去掉`,
          steps: nums,
          changes: [
            ...nums.map((n) => ({ what: `第 ${n} 步的 skipIf 挪到分支上`, op: 'edit', step: n, set: { skipIf: null } })),
            { what: '包成如果', op: 'wrap', steps: nums, block: { action: 'if', cond: { not: cond } } },
          ],
        })
        nums.forEach((n) => claimed.add(n))
      }
      i = j
    }
    return out
  },
}
