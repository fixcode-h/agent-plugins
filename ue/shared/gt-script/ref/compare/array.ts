import { op, type CompareDef } from './types.ts'

/** 数组、Set、Map（Lua 的 table 也按它）：count 配 cmp（eq / gte …）和数字 value，has 含某个值 */
export const arrayCompare: CompareDef = {
  kinds: ['array'],
  ops: [op('count', 'count'), op('has'), op('empty', 'none'), op('notEmpty', 'none')],
  default: 'notEmpty',
}

/** count 的 cmp 能写的 */
export const COUNT_CMPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const
