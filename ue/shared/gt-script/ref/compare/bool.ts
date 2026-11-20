import { op, type CompareDef } from './types.ts'

/** bool 属性、bool 状态（:exists、:onScreen…）：只有 is，value 是 true / false */
export const boolCompare: CompareDef = { kinds: ['bool'], ops: [op('is')], default: 'is' }
