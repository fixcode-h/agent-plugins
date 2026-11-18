import type { GtPath } from './types.ts'

/**
 * 统一条件（协议第 4 节）：all（全部满足）/ any（任一满足）/ not（不成立）任意嵌套，叶子是一条判断。
 * if、loop until/while、wait、守护 when、skipIf、assert、invoke expect 都用它。
 * 条件编辑器总是把根当成一个组来编辑（toEditable），存回去时只有一条判断就不包（simplify），和手写的一样短。
 * 路径相对条件根：['all', 0, 'any', 1]、['not']
 */

export type CondNode = Record<string, unknown>
export type GroupKind = 'all' | 'any' | 'not'

/** 写在条件根上、不算判断的字段 */
export const ROOT_KEYS = ['settleMs', 'elseSettleMs'] as const

export const groupKind = (n: unknown): GroupKind | undefined => {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return undefined
  const o = n as CondNode
  if (Array.isArray(o.all)) return 'all'
  if (Array.isArray(o.any)) return 'any'
  if (o.not && typeof o.not === 'object') return 'not'
  return undefined
}

export const isGroup = (n: unknown) => groupKind(n) !== undefined

/** 组的子节点：not 只有一个 */
export function childrenOf(n: CondNode): CondNode[] {
  const k = groupKind(n)
  if (k === 'not') return [n.not as CondNode]
  return k ? (n[k] as CondNode[]) : []
}

const clone = <T>(v: T): T => structuredClone(v)

function rootExtras(n: CondNode) {
  const out: CondNode = {}
  for (const k of ROOT_KEYS) if (k in n) out[k] = n[k]
  return out
}

/** 编辑用的形状：根一定是 all / any 组；没有条件时是空的 all */
export function toEditable(cond: unknown): CondNode {
  if (!cond || typeof cond !== 'object' || Array.isArray(cond)) return { all: [] }
  const c = cond as CondNode
  const k = groupKind(c)
  if (k === 'all' || k === 'any') return clone(c)
  const extras = rootExtras(c)
  const body = clone(c)
  for (const key of ROOT_KEYS) delete body[key]
  return { all: [body], ...extras }
}

/** 存回去的形状：根组只有一条判断（不是 not）时去掉这层包装，稳住时间留在根上 */
export function simplify(root: CondNode): CondNode {
  const k = groupKind(root)
  if (k !== 'all' && k !== 'any') return root
  const kids = root[k] as CondNode[]
  if (kids.length !== 1) return root
  const only = kids[0]
  if (isGroup(only) && groupKind(only) !== 'not') return root
  return { ...clone(only), ...rootExtras(root) }
}

function at(root: CondNode, p: GtPath): unknown {
  let cur: unknown = root
  for (const k of p) cur = (cur as Record<string | number, unknown> | undefined)?.[k]
  return cur
}

/** 一个组的子数组（all / any 的数组）所在路径 */
function listPath(root: CondNode, group: GtPath): GtPath | undefined {
  const k = groupKind(at(root, group))
  return k === 'all' || k === 'any' ? [...group, k] : undefined
}

/** 往组里加一条（判断或子组）；组是 not 时做不了 */
export function addTo(root: CondNode, group: GtPath, node: CondNode): CondNode | undefined {
  const lp = listPath(root, group)
  if (!lp) return undefined
  const out = clone(root)
  ;(at(out, lp) as CondNode[]).push(clone(node))
  return out
}

/** 换掉某个节点 */
export function replaceAt(root: CondNode, p: GtPath, node: CondNode): CondNode {
  if (!p.length) return clone(node)
  const out = clone(root)
  const parent = at(out, p.slice(0, -1)) as Record<string | number, unknown>
  parent[p[p.length - 1]] = clone(node)
  return out
}

/** 删掉某个节点：在 not 里的连 not 一起删 */
export function removeAt(root: CondNode, p: GtPath): CondNode {
  if (!p.length) return { all: [] }
  const last = p[p.length - 1]
  if (last === 'not') return removeAt(root, p.slice(0, -1))
  const out = clone(root)
  ;(at(out, p.slice(0, -1)) as unknown[]).splice(last as number, 1)
  return out
}

/** 点「不」：包一层 not；已经是 not 的去掉这一层 */
export function toggleNot(root: CondNode, p: GtPath): CondNode {
  const n = at(root, p) as CondNode
  if (groupKind(n) === 'not') return replaceAt(root, p, n.not as CondNode)
  return replaceAt(root, p, { not: n })
}

/** 全部满足 ↔ 任一满足 */
export function setKind(root: CondNode, group: GtPath, kind: 'all' | 'any'): CondNode {
  const n = at(root, group) as CondNode
  const k = groupKind(n)
  if (k !== 'all' && k !== 'any') return root
  if (k === kind) return root
  const next: CondNode = { ...n, [kind]: n[k] }
  delete next[k]
  return replaceAt(root, group, next)
}

/** 点「条件组」：把一条判断包成一个子组，方便往里再加 */
export function wrapGroup(root: CondNode, p: GtPath, kind: 'all' | 'any' = 'any'): CondNode {
  return replaceAt(root, p, { [kind]: [at(root, p) as CondNode] })
}

/** 组里拖动排序 */
export function moveIn(root: CondNode, group: GtPath, from: number, to: number): CondNode {
  const lp = listPath(root, group)
  if (!lp) return root
  const out = clone(root)
  const arr = at(out, lp) as CondNode[]
  if (from < 0 || from >= arr.length) return root
  const [x] = arr.splice(from, 1)
  arr.splice(Math.max(0, Math.min(to, arr.length)), 0, x)
  return out
}

/** 每条判断（叶子）：路径、是不是被 not 包着（奇数层取反） */
export function walkChecks(cond: unknown, fn: (check: CondNode, path: GtPath, negated: boolean) => void) {
  const visit = (n: unknown, p: GtPath, neg: boolean) => {
    if (!n || typeof n !== 'object') return
    const k = groupKind(n)
    if (!k) {
      fn(n as CondNode, p, neg)
      return
    }
    if (k === 'not') visit((n as CondNode).not, [...p, 'not'], !neg)
    else ((n as CondNode)[k] as unknown[]).forEach((c, i) => visit(c, [...p, k, i], neg))
  }
  visit(cond, [], false)
}

export const countChecks = (cond: unknown) => {
  let n = 0
  walkChecks(cond, () => n++)
  return n
}
