import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/**
 * DataTable（设计稿第 3 节、效果图 B1）：中间行表格，下面行编辑器（选中行的全部字段，细节面板画法），右边引用这张表的资源（可关）。
 * CompositeDataTable 的链里有 DataTable，一起走这里
 */
export const dataTableDef: LayoutDef = {
  id: 'datatable',
  label: () => t('数据表：行表格 + 行编辑器'),
  classes: () => ['DataTable', 'CompositeDataTable'],
  priority: 50,
  match: (i) => isA(i, 'DataTable'),
  regions: [
    { id: 'editor', label: () => t('行编辑器'), place: 'bottom', size: '42%', min: 140 },
    { id: 'refs', label: () => t('引用'), place: 'right', size: '320px', min: 220, optional: true },
  ],
}
