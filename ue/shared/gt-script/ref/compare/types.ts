import type { GtPropKind } from '../types.ts'

/**
 * 比较（协议 3.4）的注册表条目：一类属性一个文件，面板和 C++ 的 FGameTestCompareRegistry 同名同表
 * （compare.test.ts 读 UEKit 的协议文档核对）。数据层只认这里的描述，编辑器、校验、迁移不按 op 名字写分支。
 */

/**
 * value 写什么：none 不要 value（isNull、visible…）；one 一个值；pair 是 [a, b]（between）；
 * list 是数组（in）；count 配 cmp 和数字（array 的 count）
 */
export type CompareValue = 'none' | 'one' | 'pair' | 'list' | 'count'

export interface CompareOp {
  op: string
  value: CompareValue
  /** 能带 tol（eq / near 的容差） */
  tol?: boolean
}

export interface CompareDef {
  kinds: GtPropKind[]
  ops: CompareOp[]
  /** 新建判断项时默认选的 op（编辑器）；不能比较的类没有 */
  default?: string
  /** 不能直接比（struct、none）：gt.props 标 comparable: false，why 写原因 */
  why?: string
}

export const op = (name: string, value: CompareValue = 'one', tol = false): CompareOp =>
  tol ? { op: name, value, tol } : { op: name, value }
