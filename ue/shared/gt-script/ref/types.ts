/**
 * GameTest 对象引用（schemaVersion 5）的数据类型。协议见 UEKit 仓库 docs/game-test-ref.md。
 * 这一层只管数据：编辑页、校验、Agent 工具都用它，不依赖 node、不依赖面板宿主。
 */

/** 属性类型分类（协议 3.4）：比较方式按它选，面板和 C++ 同名 */
export type GtPropKind =
  | 'bool'
  | 'int'
  | 'float'
  | 'string'
  | 'text'
  | 'enum'
  | 'visibility'
  | 'object'
  | 'asset'
  | 'vector'
  | 'rotator'
  | 'vector2'
  | 'color'
  | 'array'
  | 'struct'
  | 'none'

/** 判断项 / 标识项（协议 3.3）：{prop, op, value} */
export interface GtIdentItem {
  /** 属性路径 v5（path.ts）：`@.X`、`@/部件.X`、`@#x`、`@item.X`、`@/部件:状态`、`@:状态` */
  prop: string
  op?: string
  value?: unknown
  tol?: number
  ignoreCase?: boolean
  /** array 的 count 比较用 */
  cmp?: string
}

/** 命中多个时（协议第 1 节） */
export type GtMany = 'error' | 'first' | 'last' | 'nearest'

/** 容器条目 / 组件所在：另一个对象（+ 容器部件） */
export interface GtRefIn {
  obj: GtRefLike
  part?: string
}

/** 在哪找（协议第 1 节）：屏上界面 / 关卡 Actor / 绑了 UnLua 的 UObject；都不限写 all */
export type GtInWord = 'screen' | 'world' | 'lua' | 'all'

/**
 * 内联对象引用（协议第 1 节）。class 也可以写 `lua:模块名`（绑的 Lua 模块是它或它的子类的 UObject）；
 * in 可以是一个词、几个词的数组（`["screen", "lua"]`）、`@来源.路径`，或另一个对象里的容器
 */
export interface GtRef {
  class: string
  in?: GtInWord | GtInWord[] | string | GtRefIn
  ident?: GtIdentItem[]
  many?: GtMany
  near?: unknown
  client?: string | number | null
  [k: string]: unknown
}

/** 引用的三种写法：objects 里的名字、内联、`$var` */
export type GtRefLike = string | GtRef

/** 动作落点（协议第 2 节） */
export interface GtTarget {
  obj: GtRefLike
  part?: string
  slate?: string
}

/** 条件里的对象判断（协议第 4 节） */
export interface GtObjCheck extends Partial<GtIdentItem> {
  obj: GtRefLike
}

/** obj.close 的一种关闭方式（协议 5.2） */
export interface GtCloseHow {
  by: 'call' | 'lua' | 'click' | 'visibility' | 'remove' | 'pop' | 'key' | 'destroy' | string
  function?: string
  args?: unknown
  part?: string
  value?: string
  key?: string
  via?: string
}

export type GtCloseVerify = 'gone' | 'hidden' | 'none'

/** _settings.json 的 identRules / closeRules / refDefaults（协议第 6 节） */
export interface GtIdentRule {
  class: string
  in?: GtRef['in']
  ident: string[]
  note?: string
}
export interface GtCloseRule {
  class: string
  how: GtCloseHow[]
  verify?: GtCloseVerify
}
export interface GtRefDefaults {
  many?: GtMany
  ignoreCase?: boolean
  tol?: { float?: number; vector?: number; rotator?: number; color?: number }
  closeVerifyMs?: number
}

/** gt.props 返回的一项（协议 7.3） */
export interface GtPropItem {
  prop: string
  /** UPROPERTY 的 Category（UE 细节面板的分类，`Appearance|Font`）；只在带元数据的构建里有 */
  cat?: string
  /** 枚举的全部成员名（下拉用） */
  members?: string[]
  name: string
  src: 'cpp' | 'bp' | 'lua' | 'state'
  type: string
  kind: GtPropKind
  value?: unknown
  distinct?: number
  changing?: boolean
  score?: number
  ops?: string[]
  comparable?: boolean
  why?: string
  readOnly?: boolean
  note?: string
  /** 只在源码里看到的 Lua 字段：值取自源码里的初始赋值（游戏没开、实例表里还没有），declAt 是「文件:行（来源）」，悬停时看 */
  fromSource?: boolean
  declAt?: string
  /** 源码里的初始赋值原文（不是字面量时 value 为空，界面显示这段） */
  srcInit?: string
  /** Lua 类的函数（gt.props class: "lua:模块" 的 functions 组）：只列出来看，不能当路径、不能当标识 */
  /** UE 类也用它（2.1.5 起 gt.props 的 functions 组）：ret 返回类型，src 是 cpp / bp / lua，pure 是 BlueprintPure */
  luaFn?: { params: string[]; from?: string; ret?: string; src?: 'cpp' | 'bp' | 'lua'; pure?: boolean }
}
export interface GtPropGroup {
  id: string
  title: string
  class?: string
  part?: string
  user?: boolean
  collapsed?: boolean
  items: GtPropItem[]
}
export interface GtPropsResult {
  class: string
  luaModule?: string
  in?: string
  siblings?: number
  groups: GtPropGroup[]
  suggest?: string[]
  matches?: number
  total?: number
  hasMore?: boolean
  nextOffset?: number
  truncated?: boolean
}

/** gt.tree 的一个节点（协议 7.1）。id 是临时句柄，不能存进脚本 */
export interface GtTreeNode {
  id: string
  parent?: string
  depth: number
  class: string
  name?: string
  user?: boolean
  owner?: string
  ownerClass?: string
  part?: string
  visible?: boolean
  onScreen?: boolean
  rect?: [number, number, number, number]
  text?: string
  container?: { kind: 'list' | 'panel' | 'entrybox'; entryClass?: string; count?: number } | null
  entry?: { container: string; index: number } | null
}

/** gt.refFor / gt.pick at 的命中链和推荐引用（协议 7.4） */
export interface GtRefForResult {
  chain: {
    node?: string
    class: string
    kind: 'entry' | 'widget' | 'actor' | 'component'
    part?: string
    note?: string
  }[]
  ref?: GtRef
  target?: GtTarget
  matches?: number
  ask?: boolean
}

/** gt.classes 的一项（类树，协议第 4 节）：kind 决定图标和「在哪找」，kids 子类个数，live 此刻实例数（游戏开着时） */
export interface GtClassItem {
  name: string
  parent?: string
  kind: 'umg' | 'actor' | 'component' | 'object' | 'lua'
  /** 蓝图类的资产路径；C++ / 引擎类没有 */
  asset?: string
  kids: number
  live?: number
  /** Lua 类的源文件（相对项目，`Content/Script/UI/Shop.lua`） */
  file?: string
}
export interface GtClassesResult {
  items: GtClassItem[]
  total: number
  hasMore: boolean
  /** 还有下一页时从这里接着取 */
  nextOffset?: number
  /** 说明（例如 UnLua 没开、Lua 类只扫到一部分），原样显示 */
  note?: string
  /** Lua 按目录列（参数 dir，GameTest 2.1.3）时第一页带：下一层子目录（name 是 / 连的完整目录）和其下的模块数 */
  dirs?: { name: string; count: number }[]
  /** 子目录太多被截断（只给了一部分） */
  dirsMore?: boolean
}
