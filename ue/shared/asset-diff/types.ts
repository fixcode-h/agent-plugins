/**
 * 资源版本差异的数据形状。快照是桥接 asset.snapshot（UELink 2.14）写出来的 JSON（UEKit docs/protocol.md），
 * 差异由 diff.ts 在服务端算好交给网页：网页只管画，不再自己比。
 */

/** 快照里的一条属性（形状和 props 操作一样，这里只用到比较和显示要的几个字段） */
export interface SnapProp {
  name: string
  displayName?: string
  category?: string
  type?: string
  value: unknown
  edit?: boolean
}

export interface SnapObject {
  name: string
  class: string
  props: SnapProp[]
}

export interface SnapComponent extends SnapObject {
  /** 挂在哪个组件下面（变量名）；空是根 */
  parent: string
  /** native = C++ 父类里的，scs = 这个蓝图加的，inherited = 父蓝图的组件在这里改过 */
  source: 'native' | 'scs' | 'inherited'
}

export interface SnapNode {
  id: string
  guid: string
  title: string
  class: string
  comment?: string
  /** 没连线的输入引脚默认值 */
  pins: Record<string, string>
  /** 输出连线：「出引脚->节点id.入引脚」 */
  links: string[]
}

export interface SnapGraph {
  name: string
  kind: string
  nodes: SnapNode[]
  pseudo: string
}

export interface SnapVar {
  name: string
  type: string
  category: string
  flags: string[]
}

/** 控件蓝图的一个控件（UELink 2.21）：path 是控件树里的路径（Root/Child），slot 是插槽对象的属性 */
export interface SnapWidget extends SnapObject {
  path: string
  parent: string
  slotClass?: string
  slot?: SnapProp[]
}

/** 控件蓝图的一个动画（UELink 2.21）：通道和 umg.anims 一致，keys 是 [秒, 值] */
export interface SnapAnim {
  name: string
  length: number
  channels: { target: string; channel: string; keys: [number, number][] }[]
}

export interface AssetSnap {
  class: string
  props: SnapProp[]
  note?: string
  /** 编辑器没开时自写读取器读的（shared/uasset/snap.ts）：note 按当时的界面语言现拼，缓存里的不算 */
  fileRead?: { failed: number }
  blueprint?: {
    parent: string
    interfaces: string[]
    variables: SnapVar[]
    components: SnapComponent[]
    graphs: SnapGraph[]
    /** 控件蓝图才有（UELink 2.21 起） */
    widgets?: SnapWidget[]
    anims?: SnapAnim[]
  }
  subobjects?: SnapObject[]
  /** 数据表 / 曲线表的行：GetTableAsJSON 的原文 */
  rows?: string
  rowStruct?: string
}

export type Change = 'add' | 'del' | 'mod' | 'same'

/** 一个值里改了的一处（结构体成员、数组元素、映射的键），path 用「.成员」「[下标]」「["键"]」拼 */
export interface LeafDiff {
  path: string
  change: Exclude<Change, 'same'>
  a?: unknown
  b?: unknown
}

export interface PropDiff {
  name: string
  label: string
  category: string
  change: Change
  a?: unknown
  b?: unknown
  /** 结构体、数组、映射里具体改了哪几处（最多 50 处，多的算进 more） */
  leaves?: LeafDiff[]
  more?: number
}

/** 一个对象（类默认值、组件模板、内嵌子对象、数据表的一行）的属性差异 */
export interface ObjDiff {
  key: string
  class: string
  change: Change
  /** 组件：挂在谁下面、来源 */
  parent?: string
  source?: SnapComponent['source']
  props: PropDiff[]
  /** 改了 / 加了 / 删了几项属性（不含没变的） */
  count: number
}

export interface VarDiff {
  name: string
  change: Change
  a?: SnapVar
  b?: SnapVar
}

/** 伪代码逐行差异的一行（和面板 UnifiedDiff 的 DiffRow 一个形状） */
export interface LineRow {
  kind: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
  n?: number
}

export interface NodeMod {
  id: string
  title: string
  pins: { pin: string; a?: string; b?: string }[]
  linksAdd: string[]
  linksDel: string[]
  commentA?: string
  commentB?: string
}

export interface GraphDiff {
  name: string
  kind: string
  change: Change
  added: SnapNode[]
  removed: SnapNode[]
  modified: NodeMod[]
  lines: LineRow[]
}

export interface AssetDiff {
  /** 两边都有的话取新版的类 */
  class: string
  blueprint: boolean
  /** 旧版里没有这个文件（新建）、新版里没有（删掉） */
  created?: boolean
  deleted?: boolean
  defaults: ObjDiff
  components: ObjDiff[]
  subobjects: ObjDiff[]
  /** 数据表的行：每行一个 ObjDiff，key 是行名 */
  rows: ObjDiff[]
  variables: VarDiff[]
  /** 父类、接口这类蓝图设置的变化：每条一句，界面直接列出来 */
  settings: { label: string; a: string; b: string }[]
  graphs: GraphDiff[]
  /** 控件蓝图的控件树：每个控件一个 ObjDiff，parent 是父控件名；插槽的属性分类写成「插槽（类）」 */
  widgets: ObjDiff[]
  anims: AnimDiff[]
  stats: DiffStats
  notes: string[]
}

export interface DiffStats {
  /** 改了的属性项数（类默认值 + 组件 + 子对象 + 行） */
  props: number
  compAdd: number
  compDel: number
  compMod: number
  vars: number
  /** 有变化的图 */
  graphs: number
  nodesAdd: number
  nodesDel: number
  nodesMod: number
  rows: number
  settings: number
  widgetAdd: number
  widgetDel: number
  widgetMod: number
  /** 有变化的动画 */
  anims: number
}

/** 一条动画通道的变化：关键帧写成「秒→值」的一串，网页直接列 */
export interface ChannelDiff {
  key: string
  change: Change
  a?: string
  b?: string
}

export interface AnimDiff {
  name: string
  change: Change
  lengthA?: number
  lengthB?: number
  channels: ChannelDiff[]
}
