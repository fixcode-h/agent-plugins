/**
 * GameTest 对象引用（schemaVersion 4）的数据类型。协议见 UEKit 仓库 docs/game-test-ref.md。
 * 这一层只管数据：编辑页、校验、迁移、Agent 工具都用它，不依赖 node、不依赖面板宿主。
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
  /** 属性路径：`@self.X`、`@部件.X`、`@lua.X`、`@item.X`、`@部件:状态`、`:状态` */
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

/** 内联对象引用（协议第 1 节） */
export interface GtRef {
  class: string
  in?: 'screen' | 'world' | 'all' | string | GtRefIn
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
  chain: { node?: string; class: string; kind: 'entry' | 'widget' | 'actor' | 'component'; part?: string; note?: string }[]
  ref?: GtRef
  target?: GtTarget
  matches?: number
  ask?: boolean
}
