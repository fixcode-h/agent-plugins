import { ownFields, strings } from '../walk.ts'
import { issue, type Check, type Issue } from './types.ts'

/**
 * $变量 有没有出处：params、vars、set 的 var、saveAs、loop 的 as（默认 item）、$index。
 * 不按先后顺序判断（守护、循环里先用后赋值是正常的），只查整份脚本里根本没有出处的名字，基本就是拼错了
 */
const REF = /\$([A-Za-z_]\w*)/g
const BUILTIN = ['index', 'item']

export function declaredVars(doc: Record<string, unknown>, steps: { step: Record<string, unknown> }[]) {
  const names = new Set<string>(BUILTIN)
  for (const k of ['params', 'vars'])
    if (doc[k] && typeof doc[k] === 'object') Object.keys(doc[k] as object).forEach((n) => names.add(n))
  const strip = (v: unknown) => (typeof v === 'string' ? v.replace(/^[@$]/, '') : '')
  for (const { step } of steps) {
    if (step.action === 'set') names.add(strip(step.var))
    names.add(strip(step.saveAs))
    names.add(strip(step.as))
    names.add(strip(step.into))
  }
  names.delete('')
  return names
}

export const vars: Check = {
  name: 'vars',
  summary: '$变量 都有出处（参数、变量、set、saveAs、循环变量）',
  run({ doc, steps }) {
    const names = declaredVars(doc, steps)
    const out: Issue[] = []
    for (const s of steps) {
      const missing = new Set<string>()
      for (const text of strings(ownFields(s.step)))
        for (const m of text.replaceAll('\\$', '').matchAll(REF)) if (!names.has(m[1])) missing.add(m[1])
      for (const n of missing)
        out.push(issue(s, 'var_undefined', `$${n} 没有出处：在 vars / params 里声明，或先用 set / saveAs 赋值`))
    }
    return out
  },
}
