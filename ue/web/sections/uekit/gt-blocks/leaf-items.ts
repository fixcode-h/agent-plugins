import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { registerInsertItems, type InsertItem } from './registry.ts'

/**
 * 原有动作（点击、按键、输入、控制台）的插入项。它们的样子走 leaf.tsx 的兜底，不单独 registerBlockUi，
 * 但节点面板的「一步操作」和 / 插入菜单要能直接加，所以只登记插入项。字段照 GameTest 动作表（gt-step-title.ts 读的那几个）
 */
const leaf = (id: string, label: () => string, hint: () => string, make: () => GtStep): InsertItem => ({
  id: `leaf-${id}`,
  group: () => t('一步操作'),
  label,
  hint,
  slash: id,
  action: id,
  make,
})

registerInsertItems([
  leaf(
    'click',
    () => t('点击控件'),
    () => t('点一下界面上的按钮、格子'),
    () => ({ action: 'click', target: '' }),
  ),
  leaf(
    'key',
    () => t('按键'),
    () => t('按一下键盘或手柄的键'),
    () => ({ action: 'key', key: '' }),
  ),
  leaf(
    'type',
    () => t('输入文字'),
    () => t('往输入框里打字'),
    () => ({ action: 'type', target: '', text: '' }),
  ),
  leaf(
    'console',
    () => t('控制台命令'),
    () => t('执行一条控制台命令（GM、stat…）'),
    () => ({ action: 'console', command: '' }),
  ),
])
