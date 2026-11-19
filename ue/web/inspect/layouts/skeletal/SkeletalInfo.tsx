import { Anchor, Bone, Info } from 'lucide-react'
import { t } from '../../../host.ts'
import { ErrorText } from '../../../ui.tsx'
import { pickStats, refPath, restTags, type StatSpec } from '../preview/model.ts'
import { GroupTitle, InfoRows, PickRow, SideCard, Why, type InfoRow } from '../preview/parts.tsx'
import type { AssetDesc } from '../preview/use-asset.ts'
import { sockets } from './model.ts'

/** 骨骼网格 / 动画序列的注册表标签里挑出来放「统计」的 */
export const SKEL_STATS = (): StatSpec => [
  ['Vertices', t('顶点')],
  ['Triangles', t('三角形')],
  ['Bones', t('骨骼数')],
  ['MorphTargets', 'Morph Targets'],
  ['LODs', 'LOD'],
  ['SequenceLength', t('长度（秒）')],
  ['NumberOfSampledFrames', t('帧数')],
  ['Number of Frames', t('帧数')],
  ['RateScale', 'Rate Scale'],
  ['AdditiveAnimType', 'Additive'],
  ['Compressed Size (KB)', t('压缩后 KB')],
]

/** 指向别的资源的标签 / 属性：骨骼、物理资产、预览网格 */
const REFS: [string, () => string][] = [
  ['Skeleton', () => t('骨骼')],
  ['PhysicsAsset', () => t('物理资产')],
  ['PreviewSkeletalMesh', () => t('预览网格')],
]

/**
 * 左栏「资源信息」（效果图 B6 左边是骨骼树）：骨骼、物理资产这些引用（点开跳过去），注册表统计，插槽（点开看细节）。
 * 骨骼层级不是反射属性，UELink 还没有导出它的接口：写明原因，不伪造一棵树
 */
export function SkeletalInfo({
  desc,
  props,
  error,
  online,
  picked,
  onPick,
  onOpen,
}: {
  desc?: AssetDesc
  props?: Record<string, unknown>
  error: string
  online: boolean
  picked: string
  onPick: (path: string) => void
  onOpen: (path: string) => void
}) {
  const refs: InfoRow[] = REFS.flatMap(([k, label]) => {
    const v = refPath(props?.[k] ?? desc?.tags?.[k])
    return v && v !== 'None' ? [{ key: k, label: label(), value: v, ref: v }] : []
  })
  const spec = SKEL_STATS()
  const stats: InfoRow[] = pickStats(desc?.tags, spec).map((s) => ({ key: s.key, label: s.label, value: s.value }))
  const rest: InfoRow[] = restTags(desc?.tags, [...spec, ...REFS.map(([k]) => [k, ''] as [string, string])])
    .slice(0, 30)
    .map(([k, v]) => ({ key: k, label: k, value: v }))
  const socks = sockets(desc?.subobjects)
  return (
    <SideCard title={t('资源信息')} icon={Info}>
      {error && (
        <div className="ue:px-3 ue:py-1">
          {online ? (
            <ErrorText>{error}</ErrorText>
          ) : (
            <Why>{t('UE 没连上：资源信息要 UE 读，打开编辑器后自动刷新')}</Why>
          )}
        </div>
      )}
      {refs.length > 0 && <InfoRows rows={refs} onOpen={onOpen} />}
      {stats.length > 0 && (
        <>
          <GroupTitle>{t('统计')}</GroupTitle>
          <InfoRows rows={stats} />
        </>
      )}
      <GroupTitle count={socks.length}>{t('插槽')}</GroupTitle>
      {socks.map((s) => (
        <PickRow
          key={s.path}
          icon={Anchor}
          label={s.name}
          title={s.path}
          on={picked === s.path}
          onClick={() => onPick(s.path)}
        />
      ))}
      {!socks.length && <Why>{t('没有网格自己的插槽（骨骼上的插槽在骨骼资源里）')}</Why>}
      {rest.length > 0 && (
        <>
          <GroupTitle>{t('其他标签')}</GroupTitle>
          <InfoRows rows={rest} />
        </>
      )}
      <div className="ue:flex ue:items-start ue:gap-1.5 ue:px-3 ue:pt-1 ue:text-subtle">
        <Bone className="ue:mt-2 ue:h-3.5 ue:w-3.5 ue:shrink-0" />
        <Why>{t('骨骼树要 UELink 导出骨骼层级（还没有这个接口），这里先列能读到的信息。')}</Why>
      </div>
    </SideCard>
  )
}
