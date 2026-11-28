import { mapAction } from '../expand/map-action.ts'
import type { GtScript, GtStep } from '../types.ts'

/**
 * 「对象调用」节点（GameTest 2.9.0 的 obj.do，用户 2026-11-28）：选一个对象，点「+」一项一项加要调的函数、要读写的字段。
 * GameTest 不解释 ops：面板存盘、运行前把 ops 展开成 obj.call / set / obj.set 写进 run（和执行 GM 的 gm.run 一样），
 * 所以 ops 是给人改的，run 只是缓存。参数照 obj.call 的写法：常量、`$变量`、`= 表达式`、`{"$obj": 对象名}`
 */

/** 调一个函数 */
export interface ObjDoCall {
  kind: 'call'
  function: string
  args?: Record<string, unknown>
  saveAs?: string
  expect?: unknown
  /** 这一项的短名称（运行记录里显示），不写用函数名 */
  title?: string
}
/** 读一个字段存进变量 */
export interface ObjDoGet {
  kind: 'get'
  /** 属性路径（game-test-ref 3.1）：`@.Count`；只写名字时当 `@.名字` */
  prop: string
  saveAs: string
  title?: string
}
/** 改一个字段 */
export interface ObjDoSet {
  kind: 'set'
  prop: string
  value: unknown
  title?: string
}
export type ObjDoOp = ObjDoCall | ObjDoGet | ObjDoSet

export interface ObjDoIssue {
  at: string
  message: string
}

const opsOf = (s: GtStep): ObjDoOp[] =>
  (Array.isArray(s.ops) ? s.ops : []).filter((o): o is ObjDoOp => !!o && typeof o === 'object' && 'kind' in o)

/** `Count` → `@.Count`；有部件时 `@.Count` → `@/部件.Count` */
export function propPath(prop: string, part: string): string {
  const p = prop.trim()
  const own = p.startsWith('@') ? p : `@.${p}`
  if (!part || !own.startsWith('@.')) return own
  return `@/${part}${own.slice(1)}`
}

/** prop() 表达式的第一个参数：脚本对象名、$变量原样，内联引用写成 JSON 文字 */
function objExpr(obj: unknown): string | undefined {
  if (typeof obj === 'string') {
    const s = obj.trim()
    if (!s || s.startsWith('@')) return undefined
    return s
  }
  if (obj && typeof obj === 'object') return JSON.stringify(obj)
  return undefined
}

/** 一个 obj.do → 它的 run（抛错带原因） */
export function objDoRun(s: GtStep): GtStep[] {
  const ops = opsOf(s)
  if (!ops.length) throw new Error('对象调用还没加要调的函数或字段：点「+ 添加」')
  const base = typeof s.id === 'string' && s.id ? s.id : 'do'
  const part = typeof s.part === 'string' ? s.part.trim() : ''
  const target: Record<string, unknown> = {}
  if (s.obj !== undefined && s.obj !== '') target.obj = s.obj
  if (part) target.part = part
  return ops.map((op, i) => {
    const id = `${base}_${i + 1}`
    const title = op.title ? { title: op.title } : {}
    if (op.kind === 'call') {
      if (!op.function) throw new Error(`第 ${i + 1} 项还没选函数`)
      const st: GtStep = { id, action: 'obj.call', ...target, function: op.function, args: op.args ?? {}, ...title }
      if (s.each === true) st.each = true
      if (op.saveAs) st.saveAs = op.saveAs
      if (op.expect !== undefined) st.expect = op.expect
      return st
    }
    if (!op.prop) throw new Error(`第 ${i + 1} 项还没选字段`)
    if (op.kind === 'set') {
      if (s.each === true) throw new Error(`第 ${i + 1} 项：「每个都调」时不能改字段，拆成循环`)
      return { id, action: 'obj.set', ...target, prop: propPath(op.prop, ''), value: op.value, ...title }
    }
    if (!op.saveAs) throw new Error(`第 ${i + 1} 项读字段 ${op.prop} 要写存到哪个变量`)
    if (s.each === true) throw new Error(`第 ${i + 1} 项：「每个都调」时不能读字段，拆成循环`)
    const ref = objExpr(s.obj)
    if (!ref) throw new Error(`第 ${i + 1} 项读字段要先选脚本里的对象或变量（来源对象 @… 读不了字段）`)
    return { id, action: 'set', var: op.saveAs, value: `=prop(${ref}, ${JSON.stringify(propPath(op.prop, part))})`, ...title }
  })
}

/** 整个脚本：每个 obj.do 按 ops 重新生成 run；展开不了的留着旧的 run、记一条 issue。没有 obj.do 时原样返回 */
export function expandObjDo(doc: GtScript): { doc: GtScript; issues: ObjDoIssue[] } {
  const issues: ObjDoIssue[] = []
  const next = mapAction(doc, 'obj.do', (s, at) => {
    try {
      const run = objDoRun(s)
      return JSON.stringify(run) === JSON.stringify(s.run) ? s : { ...s, run }
    } catch (e) {
      issues.push({ at, message: (e as Error).message })
      return s
    }
  })
  return { doc: next, issues }
}
