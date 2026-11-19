import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/**
 * 骨骼网格 / 动画序列（设计稿第 3 节、效果图 B6）：左资源信息（骨骼、插槽、统计；骨骼树 UELink 还导不出来）、
 * 中间 UE 渲染的视口、右细节；动画序列底部是共用时间轴（通知、曲线）
 */
export const skeletalDef: LayoutDef = {
  id: 'skeletal',
  label: () => t('骨骼网格 / 动画序列：资源信息 + 视口 + 细节 + 时间轴'),
  classes: () => ['SkeletalMesh', 'AnimSequence', 'AnimMontage'],
  priority: 30,
  match: (i) =>
    !i.path.includes(':') &&
    (isA(i, 'SkeletalMesh') || isA(i, 'AnimSequenceBase') || /^Anim(Sequence|Montage|Composite)$/.test(i.cls ?? '')),
  regions: [
    { id: 'info', label: () => t('资源信息'), place: 'left', size: '280px', min: 200 },
    { id: 'details', label: () => t('细节'), place: 'right', size: '380px', min: 260 },
    { id: 'timeline', label: () => t('动画时间轴'), place: 'bottom', size: '240px', min: 120, optional: true },
  ],
}
