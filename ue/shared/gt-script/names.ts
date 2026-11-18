import type { GtScript } from './types.ts'
import { walk } from './walk.ts'

/**
 * 场景里能用的 $名字：参数、变量初值、set 的变量、saveAs 存的返回值、loop 的条目名（默认 item）和 $index。
 * 表达式框补全、离线校验查「$变量未定义」都按它
 */
export function scriptNames(doc: GtScript): { name: string; from: 'param' | 'var' | 'set' | 'saveAs' | 'loop' }[] {
  const out = new Map<string, 'param' | 'var' | 'set' | 'saveAs' | 'loop'>()
  const add = (n: unknown, from: 'param' | 'var' | 'set' | 'saveAs' | 'loop') => {
    if (typeof n === 'string' && n && !out.has(n)) out.set(n, from)
  }
  for (const k of Object.keys(doc.params ?? {})) add(k, 'param')
  for (const k of Object.keys(doc.vars ?? {})) add(k, 'var')
  walk(doc, (e) => {
    if (e.step.action === 'set') add(e.step.var, 'set')
    add(e.step.saveAs, 'saveAs')
    if (e.step.action === 'loop') {
      add('index', 'loop')
      if ('each' in e.step || 'in' in e.step) add(typeof e.step.as === 'string' ? e.step.as : 'item', 'loop')
    }
  })
  return [...out].map(([name, from]) => ({ name, from }))
}
