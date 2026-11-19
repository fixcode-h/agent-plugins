import { LayoutTemplate } from 'lucide-react'
import type { ReactNode } from 'react'
import { h, t } from '../../../host.ts'
import { Badge } from '../../../ui.tsx'
import { assetName } from '../common.tsx'

/** UMG 布局的页头：名字、类、路径和父类；右边视图切换和通用按钮（版本差异、导出到配置） */
export function UmgHead({
  path,
  parent,
  badge,
  view,
  views,
  onView,
  actions,
}: {
  path: string
  parent?: string
  badge?: ReactNode
  view: string
  views: { id: string; label: string }[]
  onView: (id: string) => void
  actions?: ReactNode
}) {
  const { ui } = h()
  return (
    <header className="ue:flex ue:flex-wrap ue:items-center ue:gap-x-2 ue:gap-y-1 ue:border-b ue:border-line ue:bg-card ue:px-4 ue:py-2">
      <LayoutTemplate className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
      <span className="ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg">{assetName(path)}</span>
      <Badge>WidgetBlueprint</Badge>
      {badge}
      <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={path}>
        {path.split('.')[0]}
        {parent ? ` · ${t('父类 {p}', { p: parent.split(/[./]/).pop() ?? parent })}` : ''}
      </span>
      <div className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
        {actions}
        <ui.Segmented
          size="sm"
          label={t('视图')}
          value={view}
          onChange={onView}
          options={views.map((v) => ({ id: v.id, label: v.label }))}
        />
      </div>
    </header>
  )
}
