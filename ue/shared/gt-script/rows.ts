import { slotsOf } from './blocks/index.ts'
import { getAt } from './path.ts'
import type { GtPath, GtScript, GtStep, SlotKind } from './types.ts'

/**
 * 列表视图的行（效果图 5）：把树摊成一行一行，缩进表示块，色条按外层块画。
 * 除了步骤行，if 的「否则如果 / 否则」各有一个分隔行，空的槽有一个占位行（点它往里插第一步）
 */
export type ListRow =
  | {
      kind: 'step'
      path: GtPath
      step: GtStep
      depth: number
      /** 外层块的 action（从外到里），画色条 */
      bars: string[]
      slotKind: SlotKind
      /** 块有没有被折叠 */
      collapsed?: boolean
      /** 折叠时里面藏了几步 */
      hidden?: number
    }
  | {
      kind: 'slot'
      /** 槽的路径 */
      path: GtPath
      /** 所属块的路径 */
      owner: GtPath
      slotKind: SlotKind
      index?: number
      depth: number
      bars: string[]
    }
  | { kind: 'empty'; path: GtPath; depth: number; bars: string[]; slotKind: SlotKind }

const count = (arr: unknown): number =>
  Array.isArray(arr)
    ? arr.reduce<number>((n, s) => {
        if (!s || typeof s !== 'object') return n
        return n + 1 + slotsOf(s as GtStep).reduce((m, r) => m + count(getAt(s, r.key)), 0)
      }, 0)
    : 0

/**
 * 一个根槽（steps、setup、guards.N.do）摊成行。collapsed 是折叠了的块的 id（没有 id 的按路径字符串）
 */
export function listRows(doc: GtScript, root: GtPath, kind: SlotKind, collapsed: Set<string> = new Set()): ListRow[] {
  const rows: ListRow[] = []
  const visit = (slot: GtPath, slotKind: SlotKind, depth: number, bars: string[]) => {
    const arr = getAt(doc, slot)
    const items = Array.isArray(arr) ? arr : []
    if (!items.length && depth > 0) rows.push({ kind: 'empty', path: slot, depth, bars, slotKind })
    items.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') return
      const step = raw as GtStep
      const path = [...slot, i]
      const refs = slotsOf(step)
      const key = typeof step.id === 'string' && step.id ? step.id : path.join('.')
      const folded = refs.length > 0 && collapsed.has(key)
      rows.push({
        kind: 'step',
        path,
        step,
        depth,
        bars,
        slotKind,
        collapsed: folded || undefined,
        hidden: folded ? refs.reduce((n, r) => n + count(getAt(step, r.key)), 0) : undefined,
      })
      if (folded) return
      const inner = [...bars, step.action]
      for (const r of refs) {
        const sp = [...path, ...r.key]
        // then、do 是块本身那一行带出来的，不另起分隔行；否则如果、否则要分隔行。没写 else 的不画（块行上有「加否则」）
        if (r.kind === 'elif' || r.kind === 'else') {
          if (r.kind === 'else' && !Array.isArray(getAt(step, r.key))) continue
          rows.push({ kind: 'slot', path: sp, owner: path, slotKind: r.kind, index: r.index, depth, bars: inner })
        }
        visit(sp, r.kind, depth + 1, inner)
      }
    })
  }
  visit(root, kind, 0, [])
  return rows
}
