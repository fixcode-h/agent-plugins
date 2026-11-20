/**
 * 蓝图节点图的配色表：照 UE 5.4 蓝图编辑器（UGraphEditorSettings 的默认值，线性色换成 sRGB）。
 * 这是 UE 编辑器本身的样子，不跟面板主题走：UE 的图表本来就是深色，面板浅色主题下也画深色画布，
 * 节点、引脚、连线才和用户在 UE 里看到的一致。颜色只写在这里，组件里不散落色值
 */

/** 数据引脚和连线的类型色（UGraphEditorSettings::*PinTypeColor） */
export const UE_PIN = {
  exec: '#ffffff',
  bool: '#950000',
  byte: '#006f65',
  enum: '#006f65',
  int: '#1fe3af',
  int64: '#ace3af',
  float: '#a1ff45',
  name: '#cd82ff',
  string: '#ff00d4',
  text: '#e77caa',
  vector: '#ffca23',
  rotator: '#a0b4ff',
  transform: '#ff7300',
  struct: '#0059cb',
  object: '#00aaf5',
  class: '#5900bc',
  softObject: '#95ffff',
  softClass: '#ff95ff',
  interface: '#f1ffaa',
  delegate: '#ff3838',
  wildcard: '#817a7a',
  default: '#e1cbaa',
} as const

export type UePinKind = keyof typeof UE_PIN

/**
 * 节点标题条的底色。UE 的标题色（事件纯红、调用亮蓝…）画出来要叠一层深色主体和渐变，
 * 看上去是下面这些偏暗的颜色；这里直接写看到的颜色，再由 GraphNode 加从左往右的渐隐和上半截的光泽
 */
export const UE_TITLE = {
  event: '#8c1616',
  call: '#1f5c94',
  pure: '#3f7f34',
  macro: '#585858',
  flow: '#5a5a5a',
  cast: '#0f7c86',
  terminator: '#6b1d9c',
  other: '#4b5866',
} as const

export type UeTitleKind = keyof typeof UE_TITLE

/** 画布、节点主体、文字、选中描边 */
export const UE_CANVAS = {
  /** 画布底色和网格：细线每 16 单位一条，每 8 格一条更暗的粗线（UE 5 的 GridLineColor / GridRuleColor） */
  bg: '#262626',
  gridLine: '#353535',
  gridRule: '#161616',
  gridSize: 16,
  gridRuleEvery: 8,
  /** 右下角水印字 */
  watermark: 'rgba(255, 255, 255, 0.13)',
  /** 节点主体：深色半透明，能隐约看到下面的网格 */
  body: 'rgba(14, 14, 14, 0.86)',
  bodyBorder: 'rgba(0, 0, 0, 0.75)',
  shadow: '0 3px 8px rgba(0, 0, 0, 0.55)',
  /** 变量节点的胶囊主体（UE 的 VarNode.Body 比普通节点亮一点） */
  varBody: 'rgba(28, 28, 28, 0.92)',
  /** 标题条上半截的光泽 */
  gloss: 'rgba(255, 255, 255, 0.16)',
  title: '#ffffff',
  subtitle: 'rgba(255, 255, 255, 0.62)',
  pinText: '#dadada',
  /** 输入引脚的默认值框 */
  field: 'rgba(0, 0, 0, 0.55)',
  fieldBorder: 'rgba(255, 255, 255, 0.12)',
  fieldText: '#c8c8c8',
  /** 选中节点的描边（UE 的橙黄色） */
  selected: '#f5a623',
  /** 编译出错的节点 */
  error: '#e03131',
} as const

/** 节点文字的字体：UE 编辑器用 Roboto；面板界面是等宽字，节点里换回无衬线，宽窄才和 UE、和 ue-style.ts 的字宽估算对得上 */
export const UE_FONT = 'Roboto, "Segoe UI", "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif'

/**
 * 节点里文字的排版：面板 body 为等宽字收窄了字距和词距（word-spacing -0.2em），
 * 换成无衬线字后单词会挤到一起（Event BeginPlay 变成 EventBeginPlay），这里恢复正常
 */
export const UE_TEXT = { fontFamily: UE_FONT, wordSpacing: 'normal', letterSpacing: 'normal' } as const

/** 注释框：没给颜色时用 UE 默认的白色注释 */
export const UE_COMMENT = {
  fallback: '#ffffff',
  /** 框体、标题条的不透明度（UE 的注释是半透明色块，标题条更深） */
  bodyAlpha: 0.14,
  titleAlpha: 0.42,
  text: '#ffffff',
  /** 白色注释的标题条是浅灰，白字靠一层阴影才读得清（UE 里也有） */
  textShadow: '0 1px 2px rgba(0, 0, 0, 0.7)',
} as const

/** 连线粗细：执行线粗、数据线细；和选中节点相关的线再加粗，其余的压暗 */
export const UE_WIRE = {
  exec: 2.6,
  data: 1.7,
  hotScale: 1.5,
  dimOpacity: 0.4,
} as const
