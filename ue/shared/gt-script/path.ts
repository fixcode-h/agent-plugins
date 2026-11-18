import { slotsOf } from './blocks/index.ts'
import type { GtPath, GtStep, SlotKind } from './types.ts'

/**
 * 路径工具：路径和协议里的字符串写法互转、按路径取值、比较先后、拆出「在哪个槽的第几个、父块是谁」。
 * 所有结构操作都先把路径拆成这几样，再在槽（数组）上做 splice
 */

export const pathStr = (p: GtPath) => p.join('.')

/** `steps.3.do.0` → ['steps', 3, 'do', 0]：纯数字的段当下标 */
export const parsePath = (s: string): GtPath =>
  s
    .split('.')
    .filter(Boolean)
    .map((x) => (/^\d+$/.test(x) ? Number(x) : x))

export const samePath = (a: GtPath, b: GtPath) => a.length === b.length && a.every((x, i) => x === b[i])

/** a 是不是 b 的前缀（含相等） */
export const isPrefix = (a: GtPath, b: GtPath) => a.length <= b.length && a.every((x, i) => x === b[i])

/** 先后：逐段比，数字按大小，字符串按字典序；前缀排在前面（父在子前） */
export function comparePath(a: GtPath, b: GtPath) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x) < String(y) ? -1 : 1
  }
  return a.length - b.length
}

export function getAt(root: unknown, p: GtPath): unknown {
  let cur = root
  for (const k of p) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[k]
  }
  return cur
}

/** 取槽（数组），没有就沿路建出来（往空的「否则」里插第一步时） */
export function ensureSlot(root: Record<string, unknown>, slot: GtPath): unknown[] {
  let cur: Record<string | number, unknown> = root
  slot.forEach((k, i) => {
    const last = i === slot.length - 1
    let next = cur[k]
    if (last) {
      if (!Array.isArray(next)) cur[k] = next = []
    } else if (next === null || typeof next !== 'object') {
      cur[k] = next = typeof slot[i + 1] === 'number' ? [] : {}
    }
    cur = next as Record<string | number, unknown>
  })
  return cur as unknown as unknown[]
}

const isStep = (v: unknown): v is GtStep => !!v && typeof v === 'object' && typeof (v as GtStep).action === 'string'

/** 一步所在的位置 */
export interface StepPlace {
  /** 所在槽的路径 */
  slot: GtPath
  index: number
  /** 父块的路径；在场景根的槽（steps、setup、guards.N.do）里时没有 */
  parent?: GtPath
  /** 所在槽相对父块的键（['do']、['elif', 0, 'then']、['guards', 0, 'do']） */
  slotKey?: GtPath
  slotKind: SlotKind
  /** 在某条守护的 do 里 */
  inGuard: boolean
}

const guardDo = (k: GtPath) => k.length === 3 && k[0] === 'guards' && typeof k[1] === 'number' && k[2] === 'do'

/** 拆出一步在哪个槽的第几个、父块是谁。路径不指向一步时返回 undefined */
export function placeOf(doc: unknown, path: GtPath): StepPlace | undefined {
  const index = path[path.length - 1]
  if (typeof index !== 'number' || !isStep(getAt(doc, path))) return undefined
  const slot = path.slice(0, -1)
  for (let k = slot.length - 1; k > 0; k--) {
    if (typeof slot[k - 1] !== 'number') continue
    const parentPath = slot.slice(0, k)
    const parent = getAt(doc, parentPath)
    if (!isStep(parent)) continue
    const key = slot.slice(k)
    if (guardDo(key)) return { slot, index, parent: parentPath, slotKey: key, slotKind: 'do', inGuard: true }
    const ref = slotsOf(parent).find((r) => samePath(r.key, key))
    if (ref) return { slot, index, parent: parentPath, slotKey: key, slotKind: ref.kind, inGuard: false }
  }
  if (guardDo(slot)) return { slot, index, slotKind: 'do', inGuard: true }
  const head = slot[0]
  return { slot, index, slotKind: head === 'setup' ? 'setup' : 'steps', inGuard: false }
}
