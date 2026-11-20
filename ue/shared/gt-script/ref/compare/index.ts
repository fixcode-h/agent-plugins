import type { GtPropKind } from '../types.ts'
import { arrayCompare, COUNT_CMPS } from './array.ts'
import { boolCompare } from './bool.ts'
import { enumCompare, visibilityCompare } from './enum.ts'
import { numberCompare } from './number.ts'
import { assetCompare, objectCompare } from './object.ts'
import { noneCompare, structCompare } from './opaque.ts'
import { stringCompare, textCompare } from './text.ts'
import type { CompareDef, CompareOp } from './types.ts'
import { colorCompare, vectorCompare } from './vector.ts'

/**
 * 比较表（协议 3.4）：kind → 能用的 op。一类一个文件，在这里注册；按 kind 查，不按名字写分支。
 * 后注册的同 kind 盖掉先注册的（项目以后要加自己的比较时用 registerCompare）
 */
const table = new Map<GtPropKind, CompareDef>()

export function registerCompare(def: CompareDef) {
  for (const k of def.kinds) table.set(k, def)
}

for (const d of [
  boolCompare,
  numberCompare,
  stringCompare,
  textCompare,
  enumCompare,
  visibilityCompare,
  objectCompare,
  assetCompare,
  vectorCompare,
  colorCompare,
  arrayCompare,
  structCompare,
  noneCompare,
])
  registerCompare(d)

export const compareOf = (kind: GtPropKind) => table.get(kind)

/** 这类属性能用的 op 名字（按协议表格的顺序） */
export const opsFor = (kind: GtPropKind): string[] => (table.get(kind)?.ops ?? []).map((o) => o.op)

export const opDef = (kind: GtPropKind, op: string): CompareOp | undefined =>
  table.get(kind)?.ops.find((o) => o.op === op)

/** 编辑器新建判断项时默认选的 op；不能比较的类没有 */
export const defaultOpFor = (kind: GtPropKind) => table.get(kind)?.default

/**
 * 判断项省略 op 时按什么算（协议 3.3）：bool 按真值（就是 is true），其余 eq。
 * 有的 kind 没有 eq（enum、color…）：省略 op 就是写错了，校验报 op_type
 */
export const implicitOp = (kind: GtPropKind) => (kind === 'bool' ? 'is' : 'eq')

/** 能不能当标识、能不能判断 */
export const comparable = (kind: GtPropKind) => opsFor(kind).length > 0

/** 不能比较的原因（struct / none） */
export const whyNotComparable = (kind: GtPropKind) => table.get(kind)?.why

/** 所有 kind 里出现过的 op（op_unknown 按它查） */
export function allOps() {
  const out = new Set<string>()
  for (const d of table.values()) for (const o of d.ops) out.add(o.op)
  return out
}

/** 已注册的 kind（按注册顺序） */
export const compareKinds = () => [...table.keys()]

export { COUNT_CMPS }
export type { CompareDef, CompareOp, CompareValue } from './types.ts'
