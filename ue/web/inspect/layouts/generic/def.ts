import { t } from '../../../host.ts'
import type { LayoutDef } from '../types.ts'

/** 兜底：其他所有类型（StaticMesh、材质、DataAsset…）照旧是宽版细节面板，属性 / 函数 / 摘要与引用 */
export const genericDef: LayoutDef = {
  id: 'generic',
  label: () => t('通用：细节面板'),
  classes: () => [t('其他所有类型')],
  priority: 0,
  match: () => true,
  regions: [],
}
