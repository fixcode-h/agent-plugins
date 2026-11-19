import type { LayoutDef, LayoutInfo } from './types.ts'

/**
 * 按资源信息挑布局：priority 大的先比，同分按登记顺序，第一个 match 的就是；都不匹配时用最后的兜底（priority 0 的通用布局）。
 * 纯函数，registry.ts 和单测共用
 */
export function pickLayout<T extends LayoutDef>(list: readonly T[], info: LayoutInfo): T {
  const sorted = list.map((l, i) => ({ l, i })).sort((a, b) => b.l.priority - a.l.priority || a.i - b.i)
  return (sorted.find(({ l }) => l.match(info)) ?? sorted[sorted.length - 1]).l
}

/** 类名或类链里有这个类（子类也算：EditorUtilityWidgetBlueprint 的链里有 WidgetBlueprint） */
export const isA = (info: LayoutInfo, cls: string) => info.cls === cls || !!info.classChain?.includes(cls)

/**
 * 类型还没读回来时按路径猜（点引用跳过来的没有类名）：DT_ 是表、WBP_ 是控件蓝图、BP_ 这些是蓝图。
 * 组件模板这类子对象路径带冒号，什么都不猜
 */
export function guessClass(path: string): string | undefined {
  if (path.includes(':')) return undefined
  const name = path.split('/').pop() ?? ''
  if (/^DT_/.test(name)) return 'DataTable'
  if (/^WBP_/.test(name)) return 'WidgetBlueprint'
  if (/^(BP|ABP|BPI|BPFL)_/.test(name)) return 'Blueprint'
  return undefined
}

/** AssetForge 配置的 kind → 资源的类（资源还没生成时用配置挑布局） */
const KIND_CLASS: Record<string, string> = {
  'umg-widget': 'WidgetBlueprint',
  'data-table': 'DataTable',
  'actor-blueprint': 'Blueprint',
}
export const classOfKind = (kind?: string) => (kind ? KIND_CLASS[kind] : undefined)
