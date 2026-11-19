import { HEAD } from '../../../../shared/forge-doc/sections.ts'
import { t } from '../../../host.ts'

/** 段的显示名（段导航、标记视图、差异分组共用）：root 在 UMG 里叫控件树，别的 kind 叫主体；没登记中文名的段直接用字段名 */
export function sectionLabel(id: string, kind?: string) {
  if (id === HEAD) return t('头')
  if (id === 'styles') return t('样式')
  if (id === 'animations') return t('动画')
  if (id === 'root')
    return kind === 'umg-widget'
      ? t('控件树')
      : kind === 'actor-blueprint'
        ? t('组件树')
        : kind === 'data-table'
          ? t('行')
          : t('主体')
  return id
}
