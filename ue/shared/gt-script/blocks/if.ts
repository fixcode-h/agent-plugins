import type { BlockDef, CondRef, GtStep, SlotRef } from '../types.ts'

const elifs = (s: GtStep) => (Array.isArray(s.elif) ? (s.elif as unknown[]) : [])

/**
 * 如果 / 否则如果 / 否则：从上往下第一条成立的走。branch: "state" 只是面板画成「按状态分支」的提示，执行一样。
 * else 没写时也列出这个槽（空），列表视图和流程图都能往里放
 */
export const ifBlock: BlockDef = {
  action: 'if',
  idPrefix: 'if',
  slots: (s) => [
    { key: ['then'], kind: 'then' },
    ...elifs(s).map((_, i): SlotRef => ({ key: ['elif', i, 'then'], kind: 'elif', index: i })),
    { key: ['else'], kind: 'else' },
  ],
  wrapSlot: ['then'],
  conds: (s) => [
    { key: ['cond'], role: 'if' },
    ...elifs(s).map((_, i): CondRef => ({ key: ['elif', i, 'cond'], role: 'elif' })),
  ],
  make: () => ({ action: 'if', cond: { all: [] }, then: [] }),
}
