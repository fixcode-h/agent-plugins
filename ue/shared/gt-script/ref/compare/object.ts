import { op, type CompareDef } from './types.ts'

/** 对象引用、软引用、类引用、:class。classIs 按继承认 */
export const objectCompare: CompareDef = {
  kinds: ['object'],
  ops: [op('isNull', 'none'), op('notNull', 'none'), op('classIs'), op('nameIs')],
  default: 'notNull',
}

/** 贴图、材质等资源引用、:image：eq 是资源名或路径任一相等 */
export const assetCompare: CompareDef = {
  kinds: ['asset'],
  ops: [op('eq'), op('contains'), op('isNull', 'none'), op('notNull', 'none')],
  default: 'eq',
}
