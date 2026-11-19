import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/**
 * 枚举（UserDefinedEnum，设计稿第 3 节、效果图 B8 右上）：中间条目表格（序号、名字、显示名），右边选中条目的细节和枚举说明。
 * 只读：UELink 还没有改枚举条目的接口（报告里列了 enum.describe / enum.edit）
 */
export const enumDef: LayoutDef = {
  id: 'enum',
  label: () => t('枚举：条目列表 + 细节'),
  classes: () => ['UserDefinedEnum'],
  priority: 30,
  match: (i) => !i.path.includes(':') && isA(i, 'UserDefinedEnum'),
  regions: [{ id: 'details', label: () => t('细节'), place: 'right', size: '360px', min: 240 }],
}
