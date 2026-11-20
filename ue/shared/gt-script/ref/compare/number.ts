import { op, type CompareDef } from './types.ts'

/** 整数、浮点、:count 这类：大小比较、区间、在一组值里 */
export const NUMBER_OPS = [
  op('eq', 'one', true),
  op('ne'),
  op('gt'),
  op('gte'),
  op('lt'),
  op('lte'),
  op('between', 'pair'),
  op('in', 'list'),
]

export const numberCompare: CompareDef = { kinds: ['int', 'float'], ops: NUMBER_OPS, default: 'eq' }
