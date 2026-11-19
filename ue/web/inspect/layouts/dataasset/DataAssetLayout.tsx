import { Database, Info, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { op, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { useDetailsApi } from '../../../details/api.ts'
import { Details } from '../../../details/Details.tsx'
import { PropMarksCtx } from '../../../details/marks.ts'
import { looksLikePath, type Prop } from '../../../details/model.ts'
import type { OpenHow } from '../../../details/RefChip.tsx'
import { t } from '../../../host.ts'
import { Card, ErrorText, Note } from '../../../ui.tsx'
import { InfoView, useAssetTab } from '../common.tsx'
import { AssetHead, ClassBadges } from '../shell/AssetHead.tsx'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import type { LayoutProps } from '../types.ts'
import { CategoryIndex } from './CategoryIndex.tsx'
import { categoriesOf, inCategory, knownParent } from './model.ts'

/**
 * 数据资产的查看页（效果图 B8 左边）：页头（类 · PrimaryDataAsset）、左边分类索引、中间宽版细节面板（能改，改了未保存，资源页头保存）。
 * AssetForge 的导入标注照旧标在细节里
 */
export function DataAssetLayout({ path, info, onOpen, hint, marks, layout }: LayoutProps) {
  const { project, target } = useUe()
  const [view, setView] = useAssetTab()
  const tab = view === 'info' ? 'info' : ''
  const [cat, setCat] = useState({ path, name: '' })
  const curCat = cat.path === path ? cat.name : ''
  const data = useLoad(
    () =>
      op<{ props: Prop[]; readOnlyWhy?: string }>(
        project.id,
        'props',
        { path, filter: '', maxChars: 400 },
        target,
      ).then((r) => ({ path, ...r })),
    [project.id, path, target.instance],
  )
  const props = data.data?.path === path ? data.data.props : undefined
  const openRef = (p: string, via?: string) => (looksLikePath(p) ? (how: OpenHow) => onOpen(p, via, how) : undefined)
  const api = useDetailsApi(path, { q: '', reload: () => void data.reload(), openRef })
  const cats = categoriesOf(props ?? [])
  const shownCat = cats.some((c) => c.name === curCat) ? curCat : ''

  const head = (
    <AssetHead
      path={path}
      icon={Database}
      badges={<ClassBadges cls={info.cls} also={knownParent(info.classChain, ['PrimaryDataAsset', 'DataAsset'])} />}
      views={[
        { id: '', label: t('细节'), icon: SlidersHorizontal },
        { id: 'info', label: t('摘要与引用'), icon: Info },
      ]}
      view={tab}
      onView={(v) => setView(v)}
    />
  )
  const center =
    tab === 'info' ? (
      <Card className="ue:min-h-0 ue:flex-1" bodyClass="ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto">
        <InfoView path={path} onOpen={onOpen} />
      </Card>
    ) : (
      <Card
        className="ue:min-h-0 ue:flex-1"
        title={
          <>
            <SlidersHorizontal className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
            {t('细节')}
            {shownCat && <span className="ue:text-footnote ue:font-normal ue:text-subtle">{shownCat}</span>}
          </>
        }
        bodyClass="ue:flex ue:min-h-0 ue:flex-col"
      >
        {hint && (
          <div className="ue:px-3 ue:pt-2">
            <Note tone="info">{hint}</Note>
          </div>
        )}
        {data.error ? (
          <div className="ue:p-3">
            <ErrorText>{data.error}</ErrorText>
          </div>
        ) : (
          <PropMarksCtx.Provider value={marks ?? null}>
            <Details props={inCategory(props ?? [], shownCat)} api={api} loading={!props} />
          </PropMarksCtx.Provider>
        )}
      </Card>
    )
  return (
    <LayoutShell
      layout={layout}
      head={head}
      center={center}
      regions={{
        cats: tab !== 'info' && cats.length > 1 && (
          <CategoryIndex cats={cats} value={shownCat} onChange={(n) => setCat({ path, name: n })} />
        ),
      }}
    />
  )
}
