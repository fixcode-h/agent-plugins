import { useEffect } from 'react'
import { useLoad } from '../../../api.ts'
import { BlueprintView } from '../../../Blueprint.tsx'
import { loadBlueprintComps } from '../../../bp-comps.ts'
import { CompTree } from '../../../CompTree.tsx'
import { useUe } from '../../../ctx.tsx'
import { PropMarksCtx } from '../../../details/marks.ts'
import { t } from '../../../host.ts'
import { Props } from '../../../Props.tsx'
import { Card } from '../../../ui.tsx'
import { assetName, CommonActions, InfoView, useAssetTab } from '../common.tsx'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import type { LayoutProps } from '../types.ts'

/**
 * 蓝图（原 AssetView 的蓝图分支，行为不变）：看类默认值时左边多一栏组件树（C++ 组件 + 蓝图组件，可拖宽），
 * 右边「类默认值 / 蓝图 / 摘要与引用」。不是 Actor 蓝图（函数库、动画蓝图）时组件读出 null，不显示那一栏
 */
export function BlueprintLayout({ path, comp, onComp, onOpen, onChanged, hint, marks, layout }: LayoutProps) {
  const { project } = useUe()
  const [view, setView] = useAssetTab()
  const tab = view
  const comps = useLoad(
    () => loadBlueprintComps(project.id, path).then((items) => ({ path, items })),
    [project.id, path],
    0,
    `${project.id}/assetview/comps`,
  )
  const compItems = tab === '' && comps.data?.path === path ? comps.data.items : null
  // 刷新、切回来后选中的组件没了：回到资源本身
  useEffect(() => {
    const items = comps.data?.path === path ? comps.data.items : undefined
    if (comp && items !== undefined && !items?.some((c) => c.path === comp)) onComp('')
    // 只在组件读回来时判断
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [comps.data])
  const name = assetName(path)
  const graph = (
    <BlueprintView
      key={path}
      path={path}
      onOpen={(p) => {
        setView('')
        onOpen(p, t('蓝图'))
      }}
      onChanged={() => onChanged?.()}
    />
  )
  return (
    <LayoutShell
      layout={layout}
      regions={{
        comps: compItems && (
          <Card
            className="ue:min-h-0 ue:flex-1"
            title={t('组件')}
            aside={<span className="ue:max-w-32 ue:truncate">{name}</span>}
            bodyClass="ue:overflow-auto"
          >
            <CompTree actor={name} items={compItems} selected={comp} onSelect={onComp} />
          </Card>
        ),
      }}
      center={
        <Card className="ue:min-h-0 ue:flex-1" bodyClass="ue:flex ue:min-h-0 ue:flex-col">
          <PropMarksCtx.Provider value={comp ? null : (marks ?? null)}>
            <Props
              key={comp || path}
              path={comp || path}
              bar
              onOpen={onOpen}
              readOnlyHint={hint}
              aside={<CommonActions path={path} />}
              mainLabel={t('类默认值')}
              noFns
              more={[
                { id: 'graph', label: t('蓝图'), view: graph },
                { id: 'info', label: t('摘要与引用'), view: <InfoView path={path} onOpen={onOpen} /> },
              ]}
              moreTab={tab}
              onMoreTab={(id) => setView(id as typeof view)}
            />
          </PropMarksCtx.Provider>
        </Card>
      }
    />
  )
}
