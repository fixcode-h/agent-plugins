import type { BlockDef, CondRef } from '../types.ts'

/** 循环四种：until（每轮做完看）/ while（每轮开始前看）/ times / each（容器条目）或 in（一组值）。除 times 外必须有 max */
export const LOOP_MODES = ['until', 'while', 'times', 'each', 'in'] as const
export type LoopMode = (typeof LOOP_MODES)[number]

/** 循环最多几轮：0 或不写 = 不限（用户 2026-11-19，GameTest 1.11.3 起）；写正数时的上限只防手误 */
export const LOOP_DEFAULT_MAX = 0
export const LOOP_MAX_LIMIT = 1000000

export const loopModeOf = (s: Record<string, unknown>): LoopMode | undefined => LOOP_MODES.find((m) => m in s)

export const loop: BlockDef = {
  action: 'loop',
  idPrefix: 'loop',
  slots: () => [{ key: ['do'], kind: 'do' }],
  wrapSlot: ['do'],
  conds: (s) => {
    const out: CondRef[] = []
    if (s.until && typeof s.until === 'object') out.push({ key: ['until'], role: 'until' })
    if (s.while && typeof s.while === 'object') out.push({ key: ['while'], role: 'while' })
    return out
  },
  make: () => ({ action: 'loop', until: { all: [] }, do: [] }),
}
