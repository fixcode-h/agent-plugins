import { op, type CompareDef } from './types.ts'

/** FString、FName、Lua 字符串、:textKey。文字比较默认忽略大小写（ignoreCase） */
export const STRING_OPS = [
  op('eq'),
  op('ne'),
  op('contains'),
  op('startsWith'),
  op('endsWith'),
  op('matches'),
  op('in', 'list'),
]

export const stringCompare: CompareDef = { kinds: ['string'], ops: STRING_OPS, default: 'eq' }

/** FText、:text：同 string，多一个 key（value 是本地化键，和 :textKey 比，换语言也不变） */
export const textCompare: CompareDef = { kinds: ['text'], ops: [...STRING_OPS, op('key')], default: 'eq' }
