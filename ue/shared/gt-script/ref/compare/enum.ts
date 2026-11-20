import { op, type CompareDef } from './types.ts'

/** UEnum、枚举字节、ECheckBoxState：value 写成员名（EX::A 或 A 都认，也认整数） */
export const ENUM_OPS = [op('is'), op('isNot'), op('in', 'list')]

export const enumCompare: CompareDef = { kinds: ['enum'], ops: ENUM_OPS, default: 'is' }

/**
 * ESlateVisibility（enum 的特例）：多两个不要 value 的——visible（Visible / HitTestInvisible / SelfHitTestInvisible 任一）、
 * hidden（Collapsed / Hidden 任一）。写界面判断时几乎都是问「看不看得见」，默认就选 visible
 */
export const visibilityCompare: CompareDef = {
  kinds: ['visibility'],
  ops: [...ENUM_OPS, op('visible', 'none'), op('hidden', 'none')],
  default: 'visible',
}
