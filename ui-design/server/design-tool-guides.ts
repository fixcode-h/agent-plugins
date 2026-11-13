import type { ToolGuide } from '../../sdk/server.ts'

/**
 * design 工具的作用和使用时机（面板插件接口 8）：设置 →「MCP」照它显示，tools/list 交给 Agent 时也把
 * 「什么时候用 / 不要用」补在 description 后面（面板的 describeTool），人看到的和 Agent 拿到的是一份。
 */
type Guide = ToolGuide

const LOOK = '看设计'
const TREE = '改控件树'
const COMP = '子控件'
const ART = '图片与原画'
const ANIM = '动画与数据'
const CHECK = '对照与检查'

export const DESIGN_SUMMARY =
  'UI 设计对话专用：像在 UMG 控件树和属性面板里一样改这份设计，改动实时显示在画布上，这一轮整体检查通过后才存下。'

export const DESIGN_GUIDES: Record<string, Guide> = {
  get_tree: {
    title: '看控件树',
    summary: '看当前控件树（只列改过的属性），可以看子控件的树',
    useWhen: '改了几轮、记不清现在的结构时，或 update_widgets 之后回读改过的属性',
    avoidWhen: '开始时的树提示词里已经有；大树里找一个控件用 find_widgets',
    group: LOOK,
  },
  get_design: {
    title: '看设计概况',
    summary: '设计稿尺寸、风格、子控件列表和图片的生成状态',
    useWhen: '要知道有哪些子控件和图片、图片出到哪一步时（调一两次，不要轮询）',
    group: LOOK,
  },
  find_widgets: {
    title: '找控件',
    summary: '按名字、文字或类型找控件',
    useWhen: '树很大、要定位某个控件时',
    group: LOOK,
  },
  get_layout: {
    title: '算布局',
    summary: '不截图直接算出控件的位置和大小',
    useWhen: '核对对齐、间距和尺寸，页面没打开也要知道布局时',
    avoidWhen: '要看实际画面用 screenshot',
    group: LOOK,
  },
  add_widgets: {
    title: '加控件',
    summary: '把控件（可以带子树）加到指定父控件下',
    useWhen: '搭骨架之后分块往里填内容时，一次加一个区域',
    group: TREE,
  },
  update_widgets: {
    title: '改控件',
    summary: '合并修改控件的属性和插槽',
    useWhen: '改文字、颜色、尺寸、对齐、边距等属性时',
    group: TREE,
  },
  remove_widgets: { title: '删控件', summary: '删掉控件和它的子控件', useWhen: '不要的控件', group: TREE },
  move_widgets: {
    title: '移动控件',
    summary: '移到别的父控件下或调整顺序',
    useWhen: '调整层级和排列顺序时',
    group: TREE,
  },
  rename_widgets: {
    title: '改名',
    summary: '给控件改名（英文 PascalCase）',
    useWhen: '名字不规范或不达意时',
    group: TREE,
  },
  replace_widget: {
    title: '整个替换',
    summary: '把一个控件连同子控件换成新的',
    useWhen: '从零搭界面时先把根控件换成几个大区块的骨架；某块整体重做时',
    avoidWhen: '只改几个属性用 update_widgets',
    group: TREE,
  },
  duplicate_widgets: {
    title: '复制控件',
    summary: '复制控件和子控件，自动起名',
    useWhen: '重复的卡片、按钮、列表行，不用重写一遍',
    group: TREE,
  },
  wrap_widget: {
    title: '套一层',
    summary: '给控件外面套一层面板，接过原来的位置',
    useWhen: '要加背景、限制尺寸、改排列方式而不想打乱原来的结构时',
    group: TREE,
  },
  undo: {
    title: '撤回',
    summary: '撤回这一轮最近的几次修改',
    useWhen: '改坏了要退回去重来时',
    group: TREE,
  },
  set_design: {
    title: '风格与尺寸',
    summary: '改整体美术风格和设计稿尺寸',
    useWhen: '用户定了风格、或要换分辨率时',
    group: TREE,
  },
  create_components: {
    title: '新建子控件',
    summary: '新建可复用的 Widget Blueprint（列表条目、格子等）',
    useWhen: '同样的结构要在多处出现时，抽成子控件再引用',
    group: COMP,
  },
  resize_components: {
    title: '改子控件尺寸',
    summary: '改子控件的设计尺寸',
    useWhen: '子控件大小不合适时',
    group: COMP,
  },
  delete_components: { title: '删子控件', summary: '删掉子控件', useWhen: '不再引用的子控件', group: COMP },
  add_images: {
    title: '列图片',
    summary: '列出这一轮要新建或重新生成的图片，本轮结束后出图',
    useWhen: '界面需要背景、图标、按钮底图等美术资源时；列完要设到控件上才显示',
    group: ART,
  },
  generate_concepts: {
    title: '出原画',
    summary: '出整屏效果图候选给用户挑',
    useWhen: '先出原画的阶段、或用户要先看整体效果再搭控件时',
    group: ART,
  },
  ask_user: {
    title: '先问用户',
    summary: '动手前一次问几个问题，用户全部回答后交回',
    useWhen: '风格、内容这类关键决定还没定、猜错要整轮返工时',
    avoidWhen: '能从需求和参考图里看出来的不要问',
    group: ART,
  },
  inspect_image: {
    title: '量图',
    summary: '量一张图的像素尺寸、透明、内容范围和颜色',
    useWhen: '照着参考图做界面、要准确的尺寸和颜色时，不要目测',
    group: CHECK,
  },
  view_image: {
    title: '画坐标格看图',
    summary: '给图画上坐标格、放大局部，方便读位置',
    useWhen: '要从参考图或截图里读出元素位置和大小时',
    group: CHECK,
  },
  screenshot: {
    title: '截画布',
    summary: '截当前画布并给出每个控件的位置，标出跑出画面的控件',
    useWhen: '改完一块要看实际效果、收尾验收时',
    group: CHECK,
  },
  propose_layout: {
    title: '拆区块',
    summary: '把确认的模板拆成几个矩形区块提交',
    useWhen: '模板确认后、开始搭控件之前',
    group: CHECK,
  },
  compare_template: {
    title: '对照模板',
    summary: '截画布和模板同一块逐像素对比，给出相似度和偏移',
    useWhen: '照着确认的效果图模板搭界面、要核对还差多少时',
    group: CHECK,
  },
  check: {
    title: '检查设计',
    summary: '检查控件放法、引用、没用上的图和默认文字',
    useWhen: '改完一轮调一次；通过不等于完成，完成还要截图核对',
    group: CHECK,
  },
  add_animations: {
    title: '加动画',
    summary: '加或改 Widget Animation（网页上是动效）',
    useWhen: '用户要打开、切换、点击等动效时',
    group: ANIM,
  },
  remove_animations: { title: '删动画', summary: '删掉动画', useWhen: '不要的动画', group: ANIM },
  set_data: {
    title: '假数据',
    summary: '定义画板预览用的运行时假数据（不导出）',
    useWhen: '列表、背包这类要看填满数据效果的界面',
    group: ANIM,
  },
}
