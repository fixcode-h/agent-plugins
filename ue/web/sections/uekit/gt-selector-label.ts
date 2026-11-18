import { t } from '../../host.ts'
import { wholeScreenOf } from './gt-selector-tree.ts'

/**
 * 选择器给人看的写法：`WBP_X:.`（整个界面）显示成「WBP_X（整个界面）」，其他原样。
 * 只用于显示；存盘、复制、编辑框里改的都还是原文
 */
export function selectorLabel(target: string | undefined): string {
  const screen = wholeScreenOf(target)
  return screen !== undefined ? t('{w}（整个界面）', { w: screen }) : (target ?? '')
}
