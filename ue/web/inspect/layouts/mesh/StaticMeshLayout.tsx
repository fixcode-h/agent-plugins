import { Box } from 'lucide-react'
import { t } from '../../../host.ts'
import { DetailsCard } from '../preview/DetailsCard.tsx'
import { pickStats, type StatSpec } from '../preview/model.ts'
import { AssetHead, InfoCard, StatsStrip } from '../preview/parts.tsx'
import { PreviewPane } from '../preview/PreviewPane.tsx'
import { useAssetDesc, usePreviewView } from '../preview/use-asset.ts'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import type { LayoutProps } from '../types.ts'

/** 静态网格的注册表标签（UStaticMesh::GetAssetRegistryTags）里放进统计条的，顺序照效果图 B5 */
export const MESH_STATS = (): StatSpec => [
  ['Triangles', t('三角形')],
  ['Vertices', t('顶点')],
  ['LODs', 'LOD'],
  ['Materials', t('材质槽')],
  ['UVChannels', t('UV 通道')],
  ['ApproxSize', t('尺寸')],
  ['CollisionPrims', t('碰撞')],
  ['NaniteEnabled', 'Nanite'],
]

/**
 * 静态网格（设计稿第 3 节、效果图 B5）：页头下面一排统计（注册表标签，不用加载网格），中间 UE 渲染的视口
 * （asset.preview 缩略图模式：拖动转视角、滚轮推拉；线框、碰撞、UV 这些显示开关缩略图渲染不支持，没放），右边细节
 */
export function StaticMeshLayout(p: LayoutProps) {
  const { path, layout, onOpen, hint, marks } = p
  const [view, setView] = usePreviewView()
  const d = useAssetDesc(path)
  const stats = pickStats(d.desc?.tags, MESH_STATS(), t('开'), t('关'))
  return (
    <LayoutShell
      layout={layout}
      head={
        <>
          <AssetHead path={path} icon={Box} cls={d.desc?.class ?? 'StaticMesh'} view={view} onView={setView} />
          <StatsStrip stats={stats} aside={stats.length ? t('LOD0 · 来自资源注册表') : undefined} />
        </>
      }
      regions={{ details: <DetailsCard path={path} onOpen={onOpen} hint={hint} marks={marks} /> }}
      center={
        view === 'info' ? (
          <InfoCard path={path} onOpen={onOpen} />
        ) : (
          <PreviewPane path={path} icon={Box} title={t('视口')} />
        )
      }
    />
  )
}
