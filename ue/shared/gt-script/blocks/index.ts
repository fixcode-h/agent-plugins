import type { BlockDef, CondRef, GtStep, SlotRef } from '../types.ts'
import { group } from './group.ts'
import { ifBlock } from './if.ts'
import { loop } from './loop.ts'
import * as leaves from './leaves.ts'

/**
 * 块和动作的注册表（协议第 14 节）。数据层、列表视图、流程图都按 action 查这里，不按名字写分支；
 * 不在表里的动作（click、key、type、move…原有动作）当叶子，id 前缀 s
 */
const table = new Map<string, BlockDef>()

export function registerBlock(def: BlockDef) {
  table.set(def.action, def)
}

for (const d of [group, ifBlock, loop, ...Object.values(leaves)]) registerBlock(d)

export const blockOf = (action: unknown): BlockDef | undefined =>
  typeof action === 'string' ? table.get(action) : undefined

export const allBlocks = () => [...table.values()]

/** 有子步骤槽的才算块 */
export const isBlock = (s: unknown): s is GtStep => !!blockOf((s as GtStep | undefined)?.action)?.slots

export const slotsOf = (s: GtStep): SlotRef[] => blockOf(s.action)?.slots?.(s) ?? []

/** 一步上的条件字段：块自己的 + 所有步骤共用的 skipIf */
export function condsOf(s: GtStep): CondRef[] {
  const own = blockOf(s.action)?.conds?.(s) ?? []
  return s.skipIf && typeof s.skipIf === 'object' ? [...own, { key: ['skipIf'], role: 'skipIf' }] : own
}

export const idPrefixOf = (s: GtStep) => blockOf(s.action)?.idPrefix ?? 's'

export { LOOP_DEFAULT_MAX, LOOP_MAX_LIMIT, LOOP_MODES, loopModeOf, type LoopMode } from './loop.ts'
