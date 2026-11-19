import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/**
 * 曲线（设计稿第 3 节、效果图 B9）：左边曲线列表（CurveVector 是 X/Y/Z，CurveLinearColor 是 R/G/B/A，可关）、
 * 中间曲线编辑器（关键帧、选中键的切线手柄、Pre / Post-Infinity 外推虚线）、下面关键帧表（可关）、右边选中关键帧和曲线的细节。
 * CurveTable 的行不是属性，UELink 还读不出来：同一套布局，中间说明原因
 */
export const curveDef: LayoutDef = {
  id: 'curve',
  label: () => t('曲线：曲线编辑器 + 关键帧表 + 细节'),
  classes: () => ['CurveFloat', 'CurveVector', 'CurveLinearColor', 'CurveTable'],
  priority: 30,
  match: (i) => !i.path.includes(':') && (isA(i, 'CurveBase') || isA(i, 'CurveTable')),
  regions: [
    { id: 'curves', label: () => t('曲线列表'), place: 'left', size: '230px', min: 160, optional: true },
    { id: 'keys', label: () => t('关键帧表'), place: 'bottom', size: '30%', min: 110, optional: true },
    { id: 'details', label: () => t('细节'), place: 'right', size: '340px', min: 240 },
  ],
}
