import { isBlock, slotsOf } from './blocks/index.ts'
import { getAt } from './path.ts'
import type { GtGuard, GtPath, GtScript, GtStep, SlotKind } from './types.ts'

/** 遍历到的一步 */
export interface WalkEntry {
  path: GtPath
  step: GtStep
  /** 块的层数：场景根的槽里是 0 */
  depth: number
  slotKind: SlotKind
  /** 外层的块（从外到里），列表视图按它画色条 */
  blocks: GtStep[]
  inGuard: boolean
}

/** 遍历到的一条守护 */
export interface GuardEntry {
  path: GtPath
  guard: GtGuard
  /** 挂在哪一步上；场景顶层的守护没有 */
  owner?: GtPath
}

/** 场景根上的步骤槽：setup、steps，以及顶层每条守护的 do */
export function rootSlots(doc: GtScript): { slot: GtPath; kind: SlotKind; inGuard: boolean }[] {
  const out: { slot: GtPath; kind: SlotKind; inGuard: boolean }[] = [
    { slot: ['setup'], kind: 'setup', inGuard: false },
    { slot: ['steps'], kind: 'steps', inGuard: false },
  ]
  ;(Array.isArray(doc.guards) ? doc.guards : []).forEach((_, i) =>
    out.push({ slot: ['guards', i, 'do'], kind: 'do', inGuard: true }),
  )
  return out
}

/**
 * 深度优先遍历每一步（含块里的、守护 do 里的）。fn 返回 false 时不进这一步的子步骤（列表视图折叠用）。
 * 原数组里不是对象的元素跳过，但下标照原数组算，路径和文件对得上
 */
export function walk(doc: GtScript, fn: (e: WalkEntry) => boolean | void) {
  const visit = (slot: GtPath, kind: SlotKind, depth: number, blocks: GtStep[], inGuard: boolean) => {
    const arr = getAt(doc, slot)
    if (!Array.isArray(arr)) return
    arr.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') return
      const step = raw as GtStep
      const path = [...slot, i]
      if (fn({ path, step, depth, slotKind: kind, blocks, inGuard }) === false) return
      const inner = [...blocks, step]
      for (const r of slotsOf(step)) visit([...path, ...r.key], r.kind, depth + 1, inner, inGuard)
      if (Array.isArray(step.guards))
        step.guards.forEach((_, gi) => visit([...path, 'guards', gi, 'do'], 'do', depth + 1, inner, true))
    })
  }
  for (const r of rootSlots(doc)) visit(r.slot, r.kind, 0, [], r.inGuard)
}

/** 每条守护：顶层的和挂在块上的 */
export function walkGuards(doc: GtScript, fn: (e: GuardEntry) => void) {
  ;(Array.isArray(doc.guards) ? doc.guards : []).forEach((g, i) => fn({ path: ['guards', i], guard: g }))
  walk(doc, (e) => {
    if (Array.isArray(e.step.guards))
      e.step.guards.forEach((g, i) => fn({ path: [...e.path, 'guards', i], guard: g as GtGuard, owner: e.path }))
  })
}

export const allSteps = (doc: GtScript) => {
  const out: WalkEntry[] = []
  walk(doc, (e) => void out.push(e))
  return out
}

/** 场景里用过的 id（步骤和守护） */
export function usedIds(doc: GtScript) {
  const ids = new Set<string>()
  walk(doc, (e) => void (typeof e.step.id === 'string' && e.step.id && ids.add(e.step.id)))
  walkGuards(doc, (g) => void (typeof g.guard.id === 'string' && g.guard.id && ids.add(g.guard.id)))
  return ids
}

/** 找某个 id 的步骤路径 */
export function findPath(doc: GtScript, id: string): GtPath | undefined {
  let hit: GtPath | undefined
  walk(doc, (e) => {
    if (hit) return false
    if (e.step.id === id) hit = e.path
  })
  return hit
}

/** 场景里有没有块（if / loop / group）：没有的就是平铺步骤 */
export function hasBlocks(doc: GtScript) {
  let yes = false
  walk(doc, (e) => {
    if (isBlock(e.step)) yes = true
  })
  return yes
}

/** 按前缀发新 id：前缀后面的数字从已用的最大值往上数（s12 用过就从 s13 起），删过的号不回收，报告和历史不会对错 */
export function idMaker(used: Set<string>) {
  const next = new Map<string, number>()
  for (const id of used) {
    const m = /^([A-Za-z_]+?)(\d+)$/.exec(id)
    if (m) next.set(m[1], Math.max(next.get(m[1]) ?? 1, Number(m[2]) + 1))
  }
  return (prefix: string) => {
    let n = next.get(prefix) ?? 1
    while (used.has(`${prefix}${n}`)) n++
    next.set(prefix, n + 1)
    const id = `${prefix}${n}`
    used.add(id)
    return id
  }
}
