import { useEffect, useRef } from 'react'
import { op, useLoad } from '../api.ts'
import { AssetInfo } from '../AssetInfo.tsx'
import { BlueprintView } from '../Blueprint.tsx'
import { loadBlueprintComps } from '../bp-comps.ts'
import { CompTree } from '../CompTree.tsx'
import { useUe } from '../ctx.tsx'
import type { OpenHow } from '../details/RefChip.tsx'
import { DataTableView } from '../DataTable.tsx'
import { h, t } from '../host.ts'
import { useKept } from '../keep.ts'
import { Props } from '../Props.tsx'
import { ForgeExport } from '../sections/uekit/ForgeExport.tsx'
import { PANE_FILL, PANE_FIXED, SPLIT_ROW, SplitHandle, usePane } from '../split.tsx'
import { Badge, Card } from '../ui.tsx'

export interface AssetViewProps {
  /** 资源的对象路径 /Game/A/B.B */
  path: string
  /** Actor 蓝图选中的组件模板（地址里 `资源|组件`）；空的是资源本身 */
  comp?: string
  onComp: (comp: string) => void
  /** 点了属性、蓝图、摘要里的引用：via 是从哪来的（属性名、「蓝图」「引用」），how.ctrl 是 Ctrl+点 */
  onOpen: (path: string, via?: string, how?: OpenHow) => void
  /** 改了资源（表格单元格、蓝图编译）：资源页刷新「未保存」列表 */
  onChanged?: () => void
  /** 属性上面的说明（不放在检视区里时用，例如「改动点保存才写回」）；检视区有资源提示条，不给 */
  hint?: string
}

/** 按路径猜类型（类型还没读回来时先用，点引用跳过来的没有类名）：组件模板这类子对象路径带冒号，不算蓝图 */
const guessTable = (p: string) => /\/DT_[^/]*$/.test(p)
const guessBlueprint = (p: string) => !p.includes(':') && /\/(BP|WBP|ABP|BPI|BPFL)_[^/]*$/.test(p)

/**
 * 资源的检视（从资源页抽出来，对象页、资源页、AssetForge 页共用；设计稿第 3 节的表）：
 * - Actor 蓝图：中间一栏组件树（C++ 组件 + 蓝图组件），右边「类默认值 / 蓝图 / 摘要与引用」；
 * - DataTable：表格 / 摘要与引用；
 * - 其他资源（StaticMesh、材质、DataAsset…）：属性 / 函数 / 摘要与引用。
 * 只管看和改，不管保存（保存在资源页页头，asset-save.tsx），也不管导航历史（onOpen 交给外面）
 */
export function AssetView({ path, comp = '', onComp, onOpen, onChanged, hint }: AssetViewProps) {
  const { project } = useUe()
  const { ui } = h()
  // 真实类型：摘要里的类名；读回来之前按路径猜
  const info = useLoad(
    () =>
      op<{ class: string }>(project.id, 'asset.describe', { path }, undefined, 120000).then((r) => ({
        path,
        cls: r.class,
      })),
    [project.id, path],
    0,
    `${project.id}/assetview/cls/${path}`,
  )
  const cls = info.data?.path === path ? info.data.cls : undefined
  const isTable = cls ? cls === 'DataTable' : guessTable(path)
  const isBlueprint = !path.includes(':') && (cls ? /Blueprint$/.test(cls) : guessBlueprint(path))
  // 右栏看什么：内容（表格 / 属性）、蓝图（大纲和图表）、摘要（文件、标签、引用关系）
  const [view, setView] = useKept<'' | 'graph' | 'info'>(`${project.id}/assetview/tab`, '')
  const tab = view === 'graph' && !isBlueprint ? '' : view
  // Actor 蓝图看类默认值时多一栏组件树；不是 Actor 蓝图（控件蓝图、函数库）时读出 null，不显示这一栏
  const comps = useLoad(
    () =>
      isBlueprint
        ? loadBlueprintComps(project.id, path).then((items) => ({ path, items }))
        : Promise.resolve(undefined),
    [project.id, path, isBlueprint],
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

  const compPane = usePane('assets.comps', '22%', 180)
  const compRef = useRef<HTMLElement>(null)
  const name = path.split(/[./]/).pop() ?? path
  const infoView = <AssetInfo key={path} path={path} onOpen={(p) => onOpen(p, t('引用'))} />
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
    <div className={SPLIT_ROW}>
      {compItems && (
        <>
          <Card
            ref={compRef}
            className={PANE_FIXED}
            style={compPane.style('calc(100% - 352px)')}
            title={t('组件')}
            aside={<span className="ue:max-w-32 ue:truncate">{name}</span>}
            bodyClass="ue:overflow-auto"
          >
            <CompTree actor={name} items={compItems} selected={comp} onSelect={onComp} />
          </Card>
          <SplitHandle pane={compPane} paneRef={compRef} reserve={() => 352} />
        </>
      )}
      <Card className={PANE_FILL} bodyClass="ue:flex ue:min-h-0 ue:flex-col">
        {isTable ? (
          <>
            <header className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2.5">
              <span className="ue:truncate ue:font-mono ue:text-body ue:font-medium ue:text-fg">{name}</span>
              <Badge>DataTable</Badge>
              <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-caption ue:text-subtle" title={path}>
                {path.split('.')[0]}
              </span>
              <div className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
                <ForgeExport asset={path} />
                <ui.Segmented
                  size="sm"
                  label={t('表格 / 摘要')}
                  value={tab === 'info' ? 'info' : ''}
                  onChange={setView}
                  options={[
                    { id: '', label: t('表格') },
                    { id: 'info', label: t('摘要与引用') },
                  ]}
                />
              </div>
            </header>
            {tab === 'info' ? infoView : <DataTableView key={path} path={path} onChanged={() => onChanged?.()} />}
          </>
        ) : (
          <Props
            key={comp || path}
            path={comp || path}
            bar
            onOpen={onOpen}
            readOnlyHint={hint}
            aside={<ForgeExport asset={path} />}
            mainLabel={isBlueprint ? t('类默认值') : undefined}
            noFns={isBlueprint}
            more={[
              ...(isBlueprint ? [{ id: 'graph', label: t('蓝图'), view: graph }] : []),
              { id: 'info', label: t('摘要与引用'), view: infoView },
            ]}
            moreTab={tab}
            onMoreTab={(id) => setView(id as typeof view)}
          />
        )}
      </Card>
    </div>
  )
}
