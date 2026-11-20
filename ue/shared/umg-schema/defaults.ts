/**
 * UMG 常用控件属性的 UE 默认值（UE 5.4 各控件 CDO 的值），给「资源还没生成、编辑器没开」时的细节面板用：
 * 配置里没写的属性显示这里的默认值并标灰，改了才写进配置，改回默认就从配置删掉（用户 2026-11-20）。
 * 编辑器开着时 forge.kinds 的 schema、UE 自己的细节面板更准；离线拿不到，就按这张表。表只收配置里常写的属性，
 * 表外的属性（配置写了、表里没有）照样显示，只是没有默认值可比。
 * 网页和单测共用，不碰界面语言：分类名是 UE 细节面板里的英文分类，显示名照 UE（Font Family、Typeface）。
 */

/** 值的种类：决定细节面板用哪种控件、写回配置用什么写法 */
export type UmgKind =
  | 'text'
  | 'string'
  | 'float'
  | 'int'
  | 'bool'
  | 'enum'
  /** FLinearColor：配置里写 {R,G,B,A} */
  | 'color'
  /** FSlateColor：配置里写 {SpecifiedColor:{R,G,B,A}, ColorUseRule}，细节面板里和颜色一样是一个色块 */
  | 'slatecolor'
  /** FMargin：Left / Top / Right / Bottom */
  | 'margin'
  | 'vec2'
  | 'ref'
  | 'struct'

export interface UmgPropDef {
  name: string
  kind: UmgKind
  def: unknown
  /** UE 细节面板里的分类（顶层属性才有） */
  category?: string
  /** UE 细节面板上的显示名（和 FName 推出来的不一样时才写） */
  label?: string
  enum?: string[]
  /** 枚举在细节面板上的显示名（和 enum 一一对应；Font Family 显示 Roboto 而不是资产路径） */
  enumLabels?: string[]
  /** 结构体成员（Font、Brush 展开后的子行） */
  members?: UmgPropDef[]
  advanced?: boolean
}

const WHITE = { R: 1, G: 1, B: 1, A: 1 }
const ZERO_MARGIN = { Left: 0, Top: 0, Right: 0, Bottom: 0 }
const HALIGN = ['HAlign_Fill', 'HAlign_Left', 'HAlign_Center', 'HAlign_Right']
const VALIGN = ['VAlign_Fill', 'VAlign_Top', 'VAlign_Center', 'VAlign_Bottom']
const JUSTIFY = ['Left', 'Center', 'Right']
const ORIENT = ['Orient_Horizontal', 'Orient_Vertical']
const BUTTON_METHOD = ['DownAndUp', 'MouseDown', 'MouseUp', 'PreciseClick']

/** UE 自带的 Roboto（TextBlock 等文字控件的默认字体） */
export const ROBOTO = '/Engine/EngineFonts/Roboto.Roboto'

const p = (
  name: string,
  kind: UmgKind,
  def: unknown,
  category?: string,
  more: Partial<UmgPropDef> = {},
): UmgPropDef => ({ name, kind, def, ...(category ? { category } : {}), ...more })

/** FSlateFontInfo：UE 细节面板里展开是 Font Family / Font Material / Outline Settings / Typeface / Size / Letter Spacing / Skew */
const font = (size: number, typeface = 'Bold') =>
  p(
    'Font',
    'struct',
    { FontObject: ROBOTO, TypefaceFontName: typeface, Size: size, LetterSpacing: 0, SkewAmount: 0 },
    'Appearance',
    {
      members: [
        p('FontObject', 'enum', ROBOTO, undefined, { label: 'Font Family', enum: [ROBOTO], enumLabels: ['Roboto'] }),
        p('TypefaceFontName', 'enum', typeface, undefined, {
          label: 'Typeface',
          enum: ['Regular', 'Bold', 'Italic', 'Bold Italic', 'Light'],
        }),
        p('Size', 'float', size),
        p('LetterSpacing', 'int', 0),
        p('SkewAmount', 'float', 0, undefined, { label: 'Skew' }),
      ],
    },
  )

/** FSlateBrush：Image 的 Brush、Border 的 Background */
const brush = (name: string, category: string, drawAs = 'Image') =>
  p(name, 'struct', { ResourceObject: '', ImageSize: { X: 32, Y: 32 }, TintColor: WHITE, DrawAs: drawAs }, category, {
    members: [
      p('ResourceObject', 'ref', '', undefined, { label: 'Image' }),
      p('ImageSize', 'vec2', { X: 32, Y: 32 }),
      p('TintColor', 'slatecolor', WHITE, undefined, { label: 'Tint' }),
      p('DrawAs', 'enum', drawAs, undefined, {
        label: 'Draw As',
        enum: ['NoDrawType', 'Box', 'Border', 'Image', 'RoundedBox'],
      }),
    ],
  })

/** UWidget 自己的属性：每个控件都有，排在子类的后面（UE 细节面板的顺序） */
const WIDGET: UmgPropDef[] = [
  p('ToolTipText', 'text', '', 'Behavior', { label: 'Tool Tip Text' }),
  p('bIsEnabled', 'bool', true, 'Behavior', { label: 'Is Enabled' }),
  p('Visibility', 'enum', 'Visible', 'Behavior', {
    enum: ['Visible', 'Collapsed', 'Hidden', 'HitTestInvisible', 'SelfHitTestInvisible'],
  }),
  p(
    'RenderTransform',
    'struct',
    { Translation: { X: 0, Y: 0 }, Scale: { X: 1, Y: 1 }, Shear: { X: 0, Y: 0 }, Angle: 0 },
    'Render Transform',
    {
      label: 'Transform',
      members: [
        p('Translation', 'vec2', { X: 0, Y: 0 }),
        p('Scale', 'vec2', { X: 1, Y: 1 }),
        p('Shear', 'vec2', { X: 0, Y: 0 }),
        p('Angle', 'float', 0),
      ],
    },
  ),
  p('RenderTransformPivot', 'vec2', { X: 0.5, Y: 0.5 }, 'Render Transform', { label: 'Pivot' }),
  p('RenderOpacity', 'float', 1, 'Rendering'),
  p('Clipping', 'enum', 'Inherit', 'Rendering', {
    enum: ['Inherit', 'ClipToBounds', 'ClipToBoundsWithoutIntersecting', 'ClipToBoundsAlways', 'OnDemand'],
  }),
  p('IsVolatile', 'bool', false, 'Performance'),
]

/** 各控件类自己的属性（不含 UWidget 的），按 UE 细节面板里的先后 */
const CLASSES: Record<string, UmgPropDef[]> = {
  TextBlock: [
    p('Text', 'text', '', 'Content'),
    p('ColorAndOpacity', 'slatecolor', WHITE, 'Appearance', { label: 'Color and Opacity' }),
    font(24),
    p('ShadowOffset', 'vec2', { X: 1, Y: 1 }, 'Appearance'),
    p('ShadowColorAndOpacity', 'color', { R: 0, G: 0, B: 0, A: 0 }, 'Appearance', {
      label: 'Shadow Color and Opacity',
    }),
    p('MinDesiredWidth', 'float', 0, 'Appearance'),
    p('TextTransformPolicy', 'enum', 'None', 'Appearance', {
      label: 'Transform Policy',
      enum: ['None', 'ToLower', 'ToUpper'],
    }),
    p('Justification', 'enum', 'Left', 'Appearance', { enum: JUSTIFY }),
    p('TextOverflowPolicy', 'enum', 'Clip', 'Appearance', { label: 'Overflow Policy', enum: ['Clip', 'Ellipsis'] }),
    p('AutoWrapText', 'bool', false, 'Wrapping'),
    p('WrapTextAt', 'float', 0, 'Wrapping'),
    p('Margin', 'margin', ZERO_MARGIN, 'Wrapping'),
    p('LineHeightPercentage', 'float', 1, 'Wrapping'),
  ],
  RichTextBlock: [
    p('Text', 'text', '', 'Content'),
    p('Justification', 'enum', 'Left', 'Appearance', { enum: JUSTIFY }),
    p('AutoWrapText', 'bool', false, 'Wrapping'),
  ],
  Image: [
    brush('Brush', 'Appearance'),
    p('ColorAndOpacity', 'color', WHITE, 'Appearance', { label: 'Color and Opacity' }),
  ],
  Border: [
    p('HorizontalAlignment', 'enum', 'HAlign_Fill', 'Content', { enum: HALIGN }),
    p('VerticalAlignment', 'enum', 'VAlign_Fill', 'Content', { enum: VALIGN }),
    p('Padding', 'margin', { Left: 4, Top: 2, Right: 4, Bottom: 2 }, 'Content'),
    p('ContentColorAndOpacity', 'color', WHITE, 'Content', { label: 'Content Color and Opacity' }),
    brush('Background', 'Appearance'),
    p('BrushColor', 'color', WHITE, 'Appearance'),
    p('DesiredSizeScale', 'vec2', { X: 1, Y: 1 }, 'Appearance'),
    p('bShowEffectWhenDisabled', 'bool', true, 'Appearance', { label: 'Show Effect when Disabled' }),
  ],
  Button: [
    p('ColorAndOpacity', 'color', WHITE, 'Appearance', { label: 'Color and Opacity' }),
    p('BackgroundColor', 'color', WHITE, 'Appearance'),
    p('IsFocusable', 'bool', true, 'Interaction'),
    p('ClickMethod', 'enum', 'DownAndUp', 'Interaction', { enum: BUTTON_METHOD }),
    p('TouchMethod', 'enum', 'DownAndUp', 'Interaction', { enum: BUTTON_METHOD }),
    p('PressMethod', 'enum', 'DownAndUp', 'Interaction', { enum: ['DownAndUp', 'ButtonPress', 'ButtonRelease'] }),
  ],
  SizeBox: [
    p('bOverride_WidthOverride', 'bool', false, 'Child Layout', { label: 'Override Width' }),
    p('WidthOverride', 'float', 0, 'Child Layout'),
    p('bOverride_HeightOverride', 'bool', false, 'Child Layout', { label: 'Override Height' }),
    p('HeightOverride', 'float', 0, 'Child Layout'),
    p('MinDesiredWidth', 'float', 0, 'Child Layout'),
    p('MinDesiredHeight', 'float', 0, 'Child Layout'),
    p('MaxDesiredWidth', 'float', 0, 'Child Layout'),
    p('MaxDesiredHeight', 'float', 0, 'Child Layout'),
  ],
  Spacer: [p('Size', 'vec2', { X: 1, Y: 1 }, 'Spacer')],
  ProgressBar: [
    p('Percent', 'float', 0, 'Progress'),
    p('BarFillType', 'enum', 'LeftToRight', 'Progress', {
      enum: ['LeftToRight', 'RightToLeft', 'FillFromCenter', 'TopToBottom', 'BottomToTop'],
    }),
    p('bIsMarquee', 'bool', false, 'Progress', { label: 'Is Marquee' }),
    p('FillColorAndOpacity', 'color', WHITE, 'Appearance', { label: 'Fill Color and Opacity' }),
  ],
  CheckBox: [
    p('CheckedState', 'enum', 'Unchecked', 'Appearance', { enum: ['Unchecked', 'Checked', 'Undetermined'] }),
    p('HorizontalAlignment', 'enum', 'HAlign_Fill', 'Appearance', { enum: HALIGN }),
    p('IsFocusable', 'bool', true, 'Interaction'),
  ],
  Slider: [
    p('Value', 'float', 0, 'Appearance'),
    p('MinValue', 'float', 0, 'Appearance'),
    p('MaxValue', 'float', 1, 'Appearance'),
    p('Orientation', 'enum', 'Orient_Horizontal', 'Appearance', { enum: ORIENT }),
    p('SliderBarColor', 'color', WHITE, 'Appearance'),
    p('SliderHandleColor', 'color', WHITE, 'Appearance'),
    p('StepSize', 'float', 0.01, 'Interaction'),
    p('IsFocusable', 'bool', true, 'Interaction'),
  ],
  ScrollBox: [
    p('Orientation', 'enum', 'Orient_Vertical', 'Scroll', { enum: ORIENT }),
    p('ScrollBarVisibility', 'enum', 'Visible', 'Scroll', {
      enum: ['Visible', 'Collapsed', 'Hidden', 'HitTestInvisible', 'SelfHitTestInvisible'],
    }),
    p('ConsumeMouseWheel', 'enum', 'WhenScrollingPossible', 'Scroll', {
      enum: ['WhenScrollingPossible', 'Always', 'Never'],
    }),
    p('AlwaysShowScrollbar', 'bool', false, 'Scroll'),
    p('AllowOverscroll', 'bool', true, 'Scroll'),
  ],
  WidgetSwitcher: [p('ActiveWidgetIndex', 'int', 0, 'Switcher')],
  EditableTextBox: [
    p('Text', 'text', '', 'Content'),
    p('HintText', 'text', '', 'Content'),
    p('IsReadOnly', 'bool', false, 'Behavior'),
    p('Justification', 'enum', 'Left', 'Appearance', { enum: JUSTIFY }),
  ],
  EditableText: [
    p('Text', 'text', '', 'Content'),
    p('HintText', 'text', '', 'Content'),
    p('IsReadOnly', 'bool', false, 'Behavior'),
  ],
  MultiLineEditableTextBox: [p('Text', 'text', '', 'Content'), p('HintText', 'text', '', 'Content')],
  SpinBox: [
    p('Value', 'float', 0, 'Content'),
    p('MinValue', 'float', 0, 'Slider'),
    p('MaxValue', 'float', 0, 'Slider'),
    p('Delta', 'float', 0, 'Slider'),
  ],
  ComboBoxString: [p('SelectedOption', 'string', '', 'Content')],
  UniformGridPanel: [
    p('SlotPadding', 'margin', ZERO_MARGIN, 'Child Layout'),
    p('MinDesiredSlotWidth', 'float', 0, 'Child Layout'),
    p('MinDesiredSlotHeight', 'float', 0, 'Child Layout'),
  ],
  WrapBox: [
    p('InnerSlotPadding', 'vec2', { X: 0, Y: 0 }, 'Content'),
    p('WrapSize', 'float', 500, 'Content'),
    p('bExplicitWrapSize', 'bool', false, 'Content', { label: 'Explicit Wrap Size' }),
    p('Orientation', 'enum', 'Orient_Horizontal', 'Content', { enum: ORIENT }),
  ],
}

const pad = (def = ZERO_MARGIN) => p('Padding', 'margin', def)
const align = (h = 'HAlign_Fill', v = 'VAlign_Fill') => [
  p('HorizontalAlignment', 'enum', h, undefined, { enum: HALIGN }),
  p('VerticalAlignment', 'enum', v, undefined, { enum: VALIGN }),
]

/** 插槽属性：键是父控件的类（插槽类是「父类 + Slot」） */
const SLOTS: Record<string, UmgPropDef[]> = {
  HorizontalBox: [
    pad(),
    p('Size', 'struct', { SizeRule: 'Auto', Value: 1 }, undefined, {
      members: [p('SizeRule', 'enum', 'Auto', undefined, { enum: ['Auto', 'Fill'] }), p('Value', 'float', 1)],
    }),
    ...align(),
  ],
  Overlay: [pad(), ...align('HAlign_Left', 'VAlign_Top')],
  Button: [pad({ Left: 4, Top: 2, Right: 4, Bottom: 2 }), ...align('HAlign_Center', 'VAlign_Center')],
  SizeBox: [pad(), ...align()],
  ScrollBox: [pad(), ...align()],
  WidgetSwitcher: [pad(), ...align()],
  WrapBox: [pad(), p('bFillEmptySpace', 'bool', false, undefined, { label: 'Fill Empty Space' }), ...align()],
  UniformGridPanel: [p('Row', 'int', 0), p('Column', 'int', 0), ...align('HAlign_Left', 'VAlign_Top')],
  CanvasPanel: [
    p(
      'LayoutData',
      'struct',
      {
        Offsets: { Left: 0, Top: 0, Right: 100, Bottom: 30 },
        Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 0, Y: 0 } },
        Alignment: { X: 0, Y: 0 },
      },
      undefined,
      {
        label: 'Layout',
        members: [
          p('Offsets', 'margin', { Left: 0, Top: 0, Right: 100, Bottom: 30 }),
          p('Anchors', 'struct', { Minimum: { X: 0, Y: 0 }, Maximum: { X: 0, Y: 0 } }, undefined, {
            members: [p('Minimum', 'vec2', { X: 0, Y: 0 }), p('Maximum', 'vec2', { X: 0, Y: 0 })],
          }),
          p('Alignment', 'vec2', { X: 0, Y: 0 }),
        ],
      },
    ),
    p('bAutoSize', 'bool', false, undefined, { label: 'Size To Content' }),
    p('ZOrder', 'int', 0),
  ],
}
// Border 的内容对齐、Padding 在 Border 自己身上（配置也写在 Border 的 props 里），它的子控件不另列插槽属性
SLOTS.VerticalBox = SLOTS.HorizontalBox

/** /Script/UMG.TextBlock、TextBlock_C 这类写法都取短类名 */
const short = (c?: string) => (c ?? '').split(/[./]/).pop()?.replace(/_C$/, '') ?? ''

/** 这个类的属性表（子类自己的在前，UWidget 的在后）；不认识的类只有 UWidget 的 */
export function umgPropDefs(cls?: string): UmgPropDef[] {
  return [...(CLASSES[short(cls)] ?? []), ...WIDGET]
}

/** 父控件是 parentClass 时，子控件插槽的属性表；不认识的父类（或根节点）没有 */
export function umgSlotDefs(parentClass?: string): UmgPropDef[] {
  return SLOTS[short(parentClass)] ?? []
}
