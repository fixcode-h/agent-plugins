import type { CompareDef } from './types.ts'

/** 其他结构体：不能直接比，展开成员选（gt.props 标 comparable: false） */
export const structCompare: CompareDef = { kinds: ['struct'], ops: [], why: '结构体不能直接比，展开选里面的成员' }

/** 委托、接口、原始指针：不能当标识也不能判断 */
export const noneCompare: CompareDef = { kinds: ['none'], ops: [], why: '委托、接口、原始指针读不出能比较的值' }
