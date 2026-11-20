import { t } from '../../../host.ts'
import type { LayoutDef } from '../types.ts'

/**
 * 蓝图（设计稿第 3 节 Actor 行、效果图 A1–A4）：左上组件树、左下「我的蓝图」（变量、函数、宏、事件分发器，可在设置里关掉）、
 * 中间切图表 / 类默认值 / 摘要与引用（不放视口，用户 2026-11-20）、右边细节（选中组件看组件属性，没选看类默认值，图表里选中节点看节点的引脚）。
 * 动画蓝图、函数库这类没有组件的读出 null：不显示组件树，直接看图表。
 * 控件蓝图优先走 UMG 布局（priority 更高）；组件模板这类子对象路径带冒号，不算蓝图
 */
export const blueprintDef: LayoutDef = {
  id: 'blueprint',
  label: () => t('蓝图：组件树 + 我的蓝图 + 图表 + 细节'),
  classes: () => ['Blueprint (Actor / Pawn / Character)', 'AnimBlueprint', 'BlueprintFunctionLibrary'],
  priority: 40,
  match: (i) => !i.path.includes(':') && /Blueprint$/.test(i.cls ?? ''),
  regions: [
    { id: 'comps', label: () => t('组件树'), place: 'left', size: '300px', min: 200 },
    { id: 'mybp', label: () => t('我的蓝图'), place: 'leftBottom', size: '46%', min: 120, optional: true },
    { id: 'details', label: () => t('细节'), place: 'right', size: '380px', min: 260 },
  ],
}
