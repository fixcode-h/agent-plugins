import { widgetOf } from '../sig.ts'
import type { FlowHint, FlowRule } from '../types.ts'

/**
 * 录制时输入的固定文字（账号、角色名、搜索词、数量）：提成脚本参数，跑的时候能换值、被 call 时能传进来。
 * 参数名按输入框的控件名起（Input_Account → account），同一个值输入了几次合成一个参数。只改字段，不占步骤。
 */
const PREFIX = /^(input|edit|edt|editbox|et|txt|text|tb|textbox|inp)_?/i

function nameOf(target: unknown, n: number) {
  const w = widgetOf(target).replace(PREFIX, '').replace(/[^A-Za-z0-9_]/g, '')
  if (!w || /^\d/.test(w)) return `text${n}`
  return w[0].toLowerCase() + w.slice(1)
}

export const inputParam: FlowRule = {
  name: 'input-param',
  summary: '输入的固定文字 → 参数',
  run({ steps }) {
    const byKey = new Map<string, { name: string; value: string; uses: number[] }>()
    steps.forEach((s, i) => {
      if (s.action !== 'type' || typeof s.text !== 'string' || !s.text) return
      // 已经是变量、表达式、模板的不动
      if (/^[$=]/.test(s.text) || s.text.includes('{')) return
      const name = nameOf(s.target, byKey.size + 1)
      const key = `${name}\u0000${s.text}`
      const hit = byKey.get(key)
      if (hit) hit.uses.push(i + 1)
      else byKey.set(key, { name, value: s.text, uses: [i + 1] })
    })
    const used = new Set<string>()
    const out: FlowHint[] = []
    for (const p of byKey.values()) {
      let name = p.name
      for (let k = 2; used.has(name); k++) name = `${p.name}${k}`
      used.add(name)
      out.push({
        rule: 'input-param',
        what: `第 ${p.uses.join('、')} 步输入的「${p.value}」提成参数 $${name}，跑的时候可以换值`,
        steps: p.uses,
        changes: [
          {
            what: `输入的值提成参数 ${name}`,
            op: 'param',
            name,
            default: p.value,
            uses: p.uses.map((step) => ({ step, field: 'text' })),
          },
        ],
      })
    }
    return out
  },
}
