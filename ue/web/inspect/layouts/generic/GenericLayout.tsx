import { PropMarksCtx } from '../../../details/marks.ts'
import { t } from '../../../host.ts'
import { Props } from '../../../Props.tsx'
import { Card } from '../../../ui.tsx'
import { CommonActions, InfoView, useAssetTab } from '../common.tsx'
import type { LayoutProps } from '../types.ts'

/** 其他资源（StaticMesh、材质、DataAsset…）：宽版细节面板，属性 / 函数 / 摘要与引用（原 AssetView 的默认分支，行为不变） */
export function GenericLayout({ path, comp, onOpen, hint, marks }: LayoutProps) {
  const [view, setView] = useAssetTab()
  const tab = view === 'graph' ? '' : view
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1">
      <Card className="ue:min-w-0 ue:flex-1" bodyClass="ue:flex ue:min-h-0 ue:flex-col">
        <PropMarksCtx.Provider value={comp ? null : (marks ?? null)}>
          <Props
            key={comp || path}
            path={comp || path}
            bar
            onOpen={onOpen}
            readOnlyHint={hint}
            aside={<CommonActions path={path} />}
            more={[{ id: 'info', label: t('摘要与引用'), view: <InfoView path={path} onOpen={onOpen} /> }]}
            moreTab={tab}
            onMoreTab={(id) => setView(id as typeof view)}
          />
        </PropMarksCtx.Provider>
      </Card>
    </div>
  )
}
