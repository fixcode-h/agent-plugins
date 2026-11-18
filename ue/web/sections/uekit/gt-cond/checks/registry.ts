import type { ComponentType } from 'react'
import type { CondNode } from '../../../../../shared/gt-script/index.ts'

/**
 * 条件里一条判断的种类（协议 4.1、第 14 节「条件编辑行」注册表）：一种一个文件，条件编辑器只认这张表。
 * 按注册顺序认（先注册的先试 match），认不出来的落到 raw（直接改 JSON）
 */
export interface CheckKind {
  id: string
  /** 「+ 条件」菜单里的名字和说明 */
  label: () => string
  hint?: () => string
  /** 行首的小标签（界面、控件、文字、Lua、C++…），按这条判断实际写了什么给 */
  badge: (c: CondNode) => string
  match: (c: CondNode) => boolean
  make: () => CondNode
  /** 行里的一句话 */
  summary: (c: CondNode) => string
  /** 展开后的编辑器 */
  Editor: ComponentType<{ value: CondNode; onChange: (c: CondNode) => void }>
  /** 不进「+ 条件」菜单（raw 兜底） */
  hidden?: boolean
}

const kinds: CheckKind[] = []

export function registerCheck(k: CheckKind) {
  const i = kinds.findIndex((x) => x.id === k.id)
  if (i >= 0) kinds[i] = k
  else kinds.push(k)
}

export const allChecks = () => kinds

export const checkKindOf = (c: CondNode) =>
  kinds.find((k) => !k.hidden && k.match(c)) ?? kinds.find((k) => k.id === 'raw')!
