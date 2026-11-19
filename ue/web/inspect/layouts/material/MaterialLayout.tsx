import { CircleDot } from 'lucide-react'
import { useMemo, useState } from 'react'
import { t } from '../../../host.ts'
import { Badge } from '../../../ui.tsx'
import { DetailsCard } from '../preview/DetailsCard.tsx'
import { pickStats, shortName, type StatSpec } from '../preview/model.ts'
import { AssetHead, InfoCard, StatsStrip } from '../preview/parts.tsx'
import { PreviewPane } from '../preview/PreviewPane.tsx'
import { useAssetDesc, usePreviewView, usePropMap } from '../preview/use-asset.ts'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import type { LayoutProps } from '../types.ts'
import { InstanceSide } from './InstanceSide.tsx'
import { MaterialSide } from './MaterialSide.tsx'
import { instanceOverrides, materialNodes } from './model.ts'
import { useParentChain } from './use-material.ts'

/** 材质的注册表标签里值得放进统计条的（UE 5.x 的 UMaterial 可搜索属性） */
const MAT_STATS = (): StatSpec => [
  ['MaterialDomain', 'Domain'],
  ['BlendMode', 'Blend Mode'],
  ['ShadingModel', 'Shading Model'],
  ['ShadingModels', 'Shading Models'],
  ['TwoSided', 'Two Sided'],
  ['bUsedWithSkeletalMesh', t('骨骼网格可用')],
]

/**
 * 材质（设计稿第 3 节、效果图 B2）：左边参数和节点列表、中间 UE 渲染的材质球（拖动转视角）、右边细节。
 * 左栏点参数 / 节点 → 右栏看那个表达式的属性；节点图（连线）UELink 导不出来，不画
 */
export function MaterialLayout(p: LayoutProps) {
  const { path, layout, onOpen, hint, marks } = p
  const [view, setView] = usePreviewView()
  const d = useAssetDesc(path)
  const [picked, setPicked] = useState({ path, node: '' })
  const node = picked.path === path ? picked.node : ''
  const { params, nodes } = useMemo(() => materialNodes(d.desc?.subobjects), [d.desc])
  const stats = pickStats(d.desc?.tags, MAT_STATS(), t('开'), t('关'))
  const label = [...params, ...nodes].find((n) => n.path === node)?.type
  return (
    <LayoutShell
      layout={layout}
      head={
        <>
          <AssetHead path={path} icon={CircleDot} cls={d.desc?.class ?? 'Material'} view={view} onView={setView} />
          <StatsStrip stats={stats} />
        </>
      }
      regions={{
        list: (
          <MaterialSide
            params={params}
            nodes={nodes}
            error={d.error}
            online={d.online}
            picked={node}
            onPick={(n) => setPicked({ path, node: n })}
          />
        ),
        details: (
          <DetailsCard
            path={path}
            sub={node}
            subLabel={label}
            onBack={() => setPicked({ path, node: '' })}
            onOpen={onOpen}
            hint={hint}
            marks={marks}
          />
        ),
      }}
      center={view === 'info' ? <InfoCard path={path} onOpen={onOpen} /> : <PreviewPane path={path} icon={CircleDot} />}
    />
  )
}

/**
 * 材质实例（效果图 B3）：左边父材质链和覆盖的参数、中间预览（占大头）、右边细节（参数覆盖在细节里改）
 */
export function MaterialInstanceLayout(p: LayoutProps) {
  const { path, layout, onOpen, hint, marks } = p
  const [view, setView] = usePreviewView()
  const d = useAssetDesc(path)
  const props = usePropMap(path)
  const chain = useParentChain(path)
  const overrides = useMemo(() => instanceOverrides(props.map), [props.map])
  const parent = chain.chain && chain.chain.length > 1 ? chain.chain[chain.chain.length - 2].path : undefined
  return (
    <LayoutShell
      layout={layout}
      head={
        <AssetHead
          path={path}
          icon={CircleDot}
          cls={d.desc?.class ?? 'MaterialInstanceConstant'}
          badges={parent && <Badge title={parent}>{t('父 {p}', { p: shortName(parent) })}</Badge>}
          view={view}
          onView={setView}
        />
      }
      regions={{
        list: (
          <InstanceSide
            path={path}
            chain={chain.chain}
            chainError={chain.error}
            overrides={overrides}
            error={props.error}
            onOpen={(x) => onOpen(x, t('父材质'))}
          />
        ),
        details: <DetailsCard path={path} onOpen={onOpen} hint={hint} marks={marks} />,
      }}
      center={view === 'info' ? <InfoCard path={path} onOpen={onOpen} /> : <PreviewPane path={path} icon={CircleDot} />}
    />
  )
}
