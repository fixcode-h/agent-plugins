import { t } from '../../../host.ts'
import type { LayoutDef } from '../types.ts'

/**
 * 蓝图（Actor 蓝图有组件树；动画蓝图、函数库这类没有组件的读出 null，不显示那一栏）：类默认值 / 蓝图 / 摘要与引用。
 * 控件蓝图优先走 UMG 布局（priority 更高）；组件模板这类子对象路径带冒号，不算蓝图
 */
export const blueprintDef: LayoutDef = {
  id: 'blueprint',
  label: () => t('蓝图：组件树 + 类默认值'),
  classes: () => ['Blueprint (Actor)', 'AnimBlueprint', 'BlueprintFunctionLibrary'],
  priority: 40,
  match: (i) => !i.path.includes(':') && /Blueprint$/.test(i.cls ?? ''),
  regions: [{ id: 'comps', label: () => t('组件树'), place: 'left', size: '22%', min: 180 }],
}
