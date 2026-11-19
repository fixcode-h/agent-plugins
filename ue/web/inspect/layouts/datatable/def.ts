import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/** DataTable：行表格 / 摘要与引用（CompositeDataTable 的链里有 DataTable，一起走这里） */
export const dataTableDef: LayoutDef = {
  id: 'datatable',
  label: () => t('行表格'),
  classes: () => ['DataTable', 'CompositeDataTable'],
  priority: 50,
  match: (i) => isA(i, 'DataTable'),
  regions: [],
}
