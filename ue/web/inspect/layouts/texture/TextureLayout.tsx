import { Image } from 'lucide-react'
import { h, t } from '../../../host.ts'
import { useKept } from '../../../keep.ts'
import { useUe } from '../../../ctx.tsx'
import { DetailsCard } from '../preview/DetailsCard.tsx'
import { pickStats, type StatSpec } from '../preview/model.ts'
import { AssetHead, InfoCard, StatsStrip } from '../preview/parts.tsx'
import { PreviewPane } from '../preview/PreviewPane.tsx'
import { useAssetDesc, usePreviewView } from '../preview/use-asset.ts'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import type { LayoutProps } from '../types.ts'

/** 贴图的注册表标签（UTexture2D 的可搜索属性）里放进统计条的 */
const TEX_STATS = (): StatSpec => [
  ['Dimensions', t('尺寸')],
  ['Format', t('格式')],
  ['CompressionSettings', t('压缩')],
  ['LODGroup', 'LOD Group'],
  ['SRGB', 'sRGB'],
  ['HasAlphaChannel', 'Alpha'],
  ['NeverStream', 'Never Stream'],
  ['MipGenSettings', 'Mip Gen'],
]

type Channel = 'rgb' | 'r' | 'g' | 'b'

/** 只看一个通道：SVG 颜色矩阵把这个通道铺到 RGB 三路（灰度显示），网页里做，不再问 UE */
const MATRIX: Record<Exclude<Channel, 'rgb'>, string> = {
  r: '1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 1 0',
  g: '0 1 0 0 0  0 1 0 0 0  0 1 0 0 0  0 0 0 1 0',
  b: '0 0 1 0 0  0 0 1 0 0  0 0 1 0 0  0 0 0 1 0',
}

/**
 * 贴图（设计稿第 3 节、效果图 B4）：中间 UE 画的贴图（asset.preview，缩略图模式图不透明，所以没有 A 通道），
 * 工具条切 RGB / R / G / B；尺寸、格式、压缩在页头统计条（注册表标签，不用加载贴图）；右边细节。
 * Mip 级别 UELink 还给不了，不放这个选项
 */
export function TextureLayout(p: LayoutProps) {
  const { path, layout, onOpen, hint, marks } = p
  const { ui } = h()
  const { project } = useUe()
  const [view, setView] = usePreviewView()
  const [ch, setCh] = useKept<Channel>(`${project.id}/preview/channel`, 'rgb')
  const d = useAssetDesc(path)
  const stats = pickStats(d.desc?.tags, TEX_STATS(), t('开'), t('关'))
  return (
    <LayoutShell
      layout={layout}
      head={
        <>
          <AssetHead path={path} icon={Image} cls={d.desc?.class ?? 'Texture2D'} view={view} onView={setView} />
          <StatsStrip stats={stats} />
        </>
      }
      regions={{ details: <DetailsCard path={path} onOpen={onOpen} hint={hint} marks={marks} /> }}
      center={
        view === 'info' ? (
          <InfoCard path={path} onOpen={onOpen} />
        ) : (
          <PreviewPane
            path={path}
            icon={Image}
            title={t('贴图')}
            orbitable={false}
            max={2048}
            checker
            imgStyle={ch === 'rgb' ? undefined : { filter: `url(#ue-tex-${ch})` }}
            tools={
              <ui.Segmented
                size="sm"
                label={t('通道')}
                value={ch}
                onChange={setCh}
                options={[
                  { id: 'rgb', label: 'RGB' },
                  { id: 'r', label: 'R' },
                  { id: 'g', label: 'G' },
                  { id: 'b', label: 'B' },
                ]}
              />
            }
            overlay={
              <svg aria-hidden width="0" height="0" className="ue:absolute">
                {(Object.keys(MATRIX) as (keyof typeof MATRIX)[]).map((k) => (
                  <filter key={k} id={`ue-tex-${k}`} colorInterpolationFilters="sRGB">
                    <feColorMatrix type="matrix" values={MATRIX[k]} />
                  </filter>
                ))}
              </svg>
            }
          />
        )
      }
    />
  )
}
