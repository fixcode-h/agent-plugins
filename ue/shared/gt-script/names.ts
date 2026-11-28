import { comparePath } from './path.ts'
import type { GtPath, GtScript, GtStep } from './types.ts'
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
    // 对象调用：每一项各自存返回值、读到的字段（run 是生成的，不在遍历里）
    if (e.step.action === 'obj.do' && Array.isArray(e.step.ops))
      for (const op of e.step.ops as { saveAs?: unknown }[]) add(op?.saveAs, 'saveAs')
    if (e.step.action === 'loop') {
      add('index', 'loop')
      if ('each' in e.step || 'in' in e.step) add(typeof e.step.as === 'string' ? e.step.as : 'item', 'loop')
    }
  })
  return [...out].map(([name, from]) => ({ name, from }))
}

/**
 * 「$名字」是哪一步找到的对象（分析文档 B4）：往前找 saveAs 是它的 obj.find，回那一步的 obj（命名对象或内联引用），
 * 编辑时就能按它的类列函数、属性。给了 at 时取 at 之前最近的一个（先后按路径比，块里的也算）；
 * at 之前没有（守护里、写在后面）就取全文最后一个；都没有返回 undefined
 */
export function objOfVar(doc: GtScript, name: string, at?: GtPath): unknown {
  const n = name.replace(/^\$/, '')
  let before: { path: GtPath; obj: unknown } | undefined
  let any: unknown
  walk(doc, (e) => {
    if (e.step.action !== 'obj.find' || e.step.saveAs !== n || e.step.obj === undefined) return
    any = e.step.obj
    if (at && comparePath(e.path, at) < 0) before = { path: e.path, obj: e.step.obj }
  })
  return before ? before.obj : any
}

/** 按对象身份找一步的路径（检查器手里只有步骤对象）；找不到 undefined */
export function pathOfStep(doc: GtScript, step: GtStep): GtPath | undefined {
  let out: GtPath | undefined
  walk(doc, (e) => {
    if (out) return false
    if (e.step === step) out = e.path
  })
  return out
}
