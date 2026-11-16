import { toDisplay, type Prop } from '../../details/model.ts'

/**
 * 把配置里一个节点的 props / slot 换成细节面板（details/Details.tsx）认的属性列表，让「资源还没生成」时的预览
 * 和导入后真实资源的属性面板长一个样（用户 2026-11-16：「UE 里面怎么显示，你就怎么显示」）。
 * 配置里只有属性名和值，没有 UE 的 Category、类型：分类按 UMG 常用属性在 UE 细节面板里的分类查表（查不到归 Default），
 * 顺序按 UE 细节面板（Slot 在最前，子类的分类在前，UWidget 的 Behavior、Render Transform 这些在后），类型按值推。
 * 只是预览：查表没覆盖的属性照样显示，只是落在 Default 里。
 */
export interface PreviewNode {
  class?: string
  props?: Record<string, unknown>
  slot?: Record<string, unknown>
}

/** UE 细节面板里分类的先后（UMG 控件）；表外的分类排在这些后面、按出现顺序 */
const ORDER = [
  'Content',
  'Child Layout',
  'Spacer',
  'Appearance',
  'Style',
  'Wrapping',
  'Scroll',
  'Interaction',
  'Input',
  'Progress',
  'Default',
  'Accessibility',
  'Behavior',
  'Render Transform',
  'Rendering',
  'Performance',
  'Clipping',
  'Navigation',
  'Localization',
]

/** 属性名 → UE 细节面板里的分类（UMG 常用控件：TextBlock、Image、Border、Button、SizeBox、Spacer、ScrollBox、ProgressBar…） */
const CATS: Record<string, string> = {
  // Content
  Text: 'Content',
  HorizontalAlignment: 'Content',
  VerticalAlignment: 'Content',
  // Appearance
  ColorAndOpacity: 'Appearance',
  Font: 'Appearance',
  StrikeBrush: 'Appearance',
  ShadowOffset: 'Appearance',
  ShadowColorAndOpacity: 'Appearance',
  Justification: 'Appearance',
  Margin: 'Appearance',
  LineHeightPercentage: 'Appearance',
  TextTransformPolicy: 'Appearance',
  TextOverflowPolicy: 'Appearance',
  Brush: 'Appearance',
  BrushColor: 'Appearance',
  ContentColorAndOpacity: 'Appearance',
  DesiredSizeScale: 'Appearance',
  bShowEffectWhenDisabled: 'Appearance',
  BackgroundColor: 'Appearance',
  Background: 'Appearance',
  FillColorAndOpacity: 'Appearance',
  BarFillType: 'Appearance',
  BarFillStyle: 'Appearance',
  // Style
  WidgetStyle: 'Style',
  WidgetBarStyle: 'Style',
  Style: 'Style',
  // Wrapping
  AutoWrapText: 'Wrapping',
  WrapTextAt: 'Wrapping',
  WrappingPolicy: 'Wrapping',
  // Scroll
  Orientation: 'Scroll',
  ScrollBarVisibility: 'Scroll',
  ConsumeMouseWheel: 'Scroll',
  ScrollbarThickness: 'Scroll',
  ScrollbarPadding: 'Scroll',
  AlwaysShowScrollbar: 'Scroll',
  AllowOverscroll: 'Scroll',
  // Interaction
  IsFocusable: 'Interaction',
  bIsFocusable: 'Interaction',
  ClickMethod: 'Interaction',
  TouchMethod: 'Interaction',
  PressMethod: 'Interaction',
  // Progress
  Percent: 'Progress',
  bIsMarquee: 'Progress',
  // Spacer
  Size: 'Spacer',
  // Behavior（UWidget 的）
  ToolTipText: 'Behavior',
  ToolTipWidget: 'Behavior',
  bIsEnabled: 'Behavior',
  Visibility: 'Behavior',
  Cursor: 'Behavior',
  bOverride_Cursor: 'Behavior',
  // Render Transform
  RenderTransform: 'Render Transform',
  RenderTransformPivot: 'Render Transform',
  // Rendering
  RenderOpacity: 'Rendering',
  Clipping: 'Rendering',
  PixelSnapping: 'Rendering',
  // Performance
  bIsVolatile: 'Performance',
  IsVolatile: 'Performance',
  // Navigation、Localization、Accessibility
  Navigation: 'Navigation',
  FlowDirectionPreference: 'Localization',
  AccessibleBehavior: 'Accessibility',
  AccessibleText: 'Accessibility',
  AccessibleSummaryBehavior: 'Accessibility',
  bCanChildrenBeAccessible: 'Accessibility',
}

/** 和类有关的：SizeBox 的尺寸覆盖在 Child Layout（TextBlock 的 MinDesiredWidth 在 Appearance），Border 的 Padding 在 Content */
const CLASS_CATS: Record<string, Record<string, string>> = {
  SizeBox: Object.fromEntries(
    [
      'WidthOverride',
      'HeightOverride',
      'MinDesiredWidth',
      'MinDesiredHeight',
      'MaxDesiredWidth',
      'MaxDesiredHeight',
      'MinAspectRatio',
      'MaxAspectRatio',
      'bOverride_WidthOverride',
      'bOverride_HeightOverride',
    ].map((k) => [k, 'Child Layout']),
  ),
  Border: { Padding: 'Content' },
  Button: { Padding: 'Content' },
}

/** /Script/UMG.TextBlock、TextBlock_C 这类写法都取短类名 */
export const shortClass = (c?: string) => (c ?? '').split(/[./]/).pop()?.replace(/_C$/, '') ?? ''

export function categoryOf(cls: string | undefined, name: string) {
  const c = shortClass(cls)
  return CLASS_CATS[c]?.[name] ?? CATS[name] ?? (/^Min|^Max/.test(name) ? 'Appearance' : 'Default')
}

/**
 * 值整理成 UE 细节面板的样子：
 * - UE 文本格式的结构体 "(R=1,G=0.5,B=0,A=1)" 拆成对象（颜色、向量就能出色块、分量框）；
 * - FSlateColor {SpecifiedColor: {R,G,B,A}, ColorUseRule?} 在 UE 里就是一个色块，直接取里面的颜色
 */
export function normalizeValue(v: unknown): unknown {
  if (typeof v === 'string') {
    const m = /^\(\s*([A-Za-z_]\w*\s*=\s*-?[\d.eE+-]+\s*(?:,\s*[A-Za-z_]\w*\s*=\s*-?[\d.eE+-]+\s*)*)\)$/.exec(v.trim())
    if (!m) return v
    const out: Record<string, number> = {}
    for (const part of m[1].split(',')) {
      const [k, n] = part.split('=').map((x) => x.trim())
      out[k] = Number(n)
    }
    return Object.values(out).every(Number.isFinite) ? out : v
  }
  if (Array.isArray(v)) return v.map(normalizeValue)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const keys = Object.keys(o)
    if ('SpecifiedColor' in o && keys.every((k) => k === 'SpecifiedColor' || k === 'ColorUseRule'))
      return normalizeValue(o.SpecifiedColor)
    return Object.fromEntries(keys.map((k) => [k, normalizeValue(o[k])]))
  }
  return v
}

function typeOf(v: unknown) {
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'number') return Number.isInteger(v) ? 'int32' : 'float'
  if (typeof v === 'string') return 'FString'
  return ''
}

function toProp(name: string, raw: unknown, category: string, why: string, path = name): Prop {
  const value = normalizeValue(raw)
  const type = typeOf(value)
  return {
    name: path,
    // 插槽属性的名字带 Slot. 前缀（和 UE 的属性路径一致、不和控件本身的同名属性撞），显示名不带
    displayName: toDisplay(name, type === 'bool'),
    type,
    category,
    value,
    edit: true,
    readOnly: true,
    readOnlyWhy: why,
    ...(Array.isArray(value) ? { container: 'array' as const, count: value.length, fixedSize: true } : {}),
  }
}

/**
 * 一个节点的属性列表：插槽属性在最前（UE 里是「Slot (HorizontalBoxSlot)」），然后按 ORDER 排分类，同一分类里保持配置里的顺序。
 * parentClass 是父节点的类，用来写插槽的类名；why 是只读原因（翻译好的文字，这个文件不碰界面语言，好单测）
 */
export function previewProps(node: PreviewNode, parentClass: string | undefined, why: string): Prop[] {
  const slotCat = parentClass ? `Slot (${shortClass(parentClass)}Slot)` : 'Slot'
  const slot = Object.entries(node.slot ?? {}).map(([k, v]) => toProp(k, v, slotCat, why, `Slot.${k}`))
  const rank = (c: string) => {
    const i = ORDER.indexOf(c)
    return i < 0 ? ORDER.length : i
  }
  const props = Object.entries(node.props ?? {})
    .map(([k, v], i) => ({ p: toProp(k, v, categoryOf(node.class, k), why), i }))
    .sort((a, b) => rank(a.p.category!) - rank(b.p.category!) || a.i - b.i)
    .map((x) => x.p)
  return [...slot, ...props]
}
