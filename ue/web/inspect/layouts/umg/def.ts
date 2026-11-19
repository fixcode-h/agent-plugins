import { t } from '../../../host.ts'
import { isA } from '../pick.ts'
import type { LayoutDef } from '../types.ts'

/**
 * 控件蓝图（设计稿第 4 节、效果图 U1–U4）：左上控件树、左下动画列表、中间设计器、右边选中控件的细节、底部动画时间轴。
 * 资源还没生成时也能按 AssetForge 配置画（offline）
 */
export const umgDef: LayoutDef = {
  id: 'umg',
  label: () => t('UMG 设计器'),
  classes: () => ['WidgetBlueprint', 'EditorUtilityWidgetBlueprint'],
  priority: 100,
  match: (i) => !i.path.includes(':') && isA(i, 'WidgetBlueprint'),
  offline: true,
  regions: [
    { id: 'tree', label: () => t('控件树'), place: 'left', size: '280px', min: 200 },
    { id: 'anims', label: () => t('动画列表'), place: 'leftBottom', size: '200px', min: 90, optional: true },
    { id: 'details', label: () => t('细节'), place: 'right', size: '360px', min: 260 },
    { id: 'timeline', label: () => t('动画时间轴'), place: 'bottom', size: '240px', min: 120, optional: true },
  ],
}
