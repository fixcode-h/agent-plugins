import { DataTableView } from '../../../DataTable.tsx'
import { h, t } from '../../../host.ts'
import { Badge, Card } from '../../../ui.tsx'
import { assetName, CommonActions, InfoView, useAssetTab } from '../common.tsx'
import type { LayoutProps } from '../types.ts'

/** DataTable：页头（名字、路径、通用按钮、表格 / 摘要切换）+ 行表格（原 AssetView 的表格分支，行为不变） */
export function DataTableLayout({ path, onOpen, onChanged }: LayoutProps) {
  const { ui } = h()
  const [view, setView] = useAssetTab()
  const tab = view === 'info' ? 'info' : ''
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1">
      <Card className="ue:min-w-0 ue:flex-1" bodyClass="ue:flex ue:min-h-0 ue:flex-col">
        <header className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2.5">
          <span className="ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg">{assetName(path)}</span>
          <Badge>DataTable</Badge>
          <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={path}>
            {path.split('.')[0]}
          </span>
          <div className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
            <CommonActions path={path} />
            <ui.Segmented
              size="sm"
              label={t('表格 / 摘要')}
              value={tab}
              onChange={setView}
              options={[
                { id: '', label: t('表格') },
                { id: 'info', label: t('摘要与引用') },
              ]}
            />
          </div>
        </header>
        {tab === 'info' ? (
          <InfoView path={path} onOpen={onOpen} />
        ) : (
          <DataTableView key={path} path={path} onChanged={() => onChanged?.()} />
        )}
      </Card>
    </div>
  )
}
