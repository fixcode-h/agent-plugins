import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/**
 * 结构体（UserDefinedStruct，设计稿第 3 节、效果图 B8 右下）：中间成员表格（名字、类型、默认值、提示），右边选中成员的细节。
 * 只读：UELink 还没有改结构体成员的接口（报告里列了 struct.edit）
 */
export const structDef: LayoutDef = {
  id: 'struct',
  label: () => t('结构体：成员列表 + 细节'),
  classes: () => ['UserDefinedStruct'],
  priority: 30,
  match: (i) => !i.path.includes(':') && isA(i, 'UserDefinedStruct'),
  regions: [{ id: 'details', label: () => t('细节'), place: 'right', size: '380px', min: 240 }],
}
