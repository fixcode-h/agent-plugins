/**
 * Actor 蓝图布局（设计稿第 3 节 Actor 行、效果图 A1–A4）的纯数据部分：bp.outline 回包的类型、
 * 「我的蓝图」怎么分组、引脚和变量类型的配色。不带 React，单测（blueprint.test.ts）直接 import。
 */

export interface BpParam {
  name: string
  type: string
}

export interface BpGraphBrief {
  name: string
  /** event / function / macro / interface / delegate / sub（UELink GraphKind） */
  kind: string
  nodes: number
  inputs?: BpParam[]
  outputs?: BpParam[]
  pure?: boolean
  events?: { name: string; node: string; custom: boolean }[]
  /** 函数的分类（UELink 2.18 bp.layout，Default 时省略） */
  category?: string
  /** protected / private（public 时省略） */
  access?: string
  const?: boolean
}

export interface BpVar {
  name: string
  type: string
  category?: string
  replication?: string
  instanceEditable: boolean
  exposeOnSpawn?: boolean
  default?: unknown
  /** 父蓝图链上定义的（UELink 2.18 bp.layout），排在自己的后面 */
  inherited?: boolean
}

/** 事件分发器：2.18 起带签名参数和是否继承 */
export interface BpDispatcher extends BpParam {
  params?: BpParam[]
  inherited?: boolean
}

/** bp.outline 的回包里这个布局用到的部分（组件走 components 操作，编译结果给图表页） */
export interface BpOutline {
  path: string
  name: string
  parent: string
  status: string
  dirty: boolean
  interfaces: string[]
  variables: BpVar[]
  /** 事件分发器：UELink 2.18 起带 params（签名）和 inherited，旧桥接只有名字和类型 */
  dispatchers: BpDispatcher[]
  graphs: BpGraphBrief[]
  timelines: string[]
  compile?: { status: string; errors?: number; warnings?: number }
}

/** UE 构造脚本那张函数图的固定名字 */
export const CONSTRUCTION = 'UserConstructionScript'

export type SectionId = 'graphs' | 'functions' | 'macros' | 'variables' | 'dispatchers'

/** 「我的蓝图」的一行：图（点了在中间打开）、变量、分发器 */
export interface MyBpItem {
  key: string
  name: string
  section: SectionId
  /** 能在中间打开的图名（图、函数、宏）；变量、分发器没有 */
  graph?: string
  graphKind?: string
  /** 变量、分发器的类型；函数的参数 */
  type?: string
  inputs?: BpParam[]
  outputs?: BpParam[]
  pure?: boolean
  /** 变量：实例可编辑（UE 里的「眼睛」） */
  editable?: boolean
  replication?: string
  category?: string
  /** 函数的访问级别（protected / private）和 const */
  access?: string
  isConst?: boolean
  /** 继承自父蓝图的变量 / 分发器 */
  inherited?: boolean
  /** 分发器的签名参数 */
  params?: BpParam[]
}

export interface MyBpSection {
  id: SectionId
  items: MyBpItem[]
}

const hit = (q: string, ...s: (string | undefined)[]) => {
  const k = q.trim().toLowerCase()
  return !k || s.some((x) => x?.toLowerCase().includes(k))
}

/**
 * 按 UE「我的蓝图」面板分组：图表（事件图 + 构造脚本）、函数（含接口函数）、宏、变量、事件分发器。
 * 分发器的签名图（delegate）和折叠出来的子图（sub）UE 也不在这里单列，跳过。q 按名字和类型筛，空组照样返回（UE 也显示 0）
 */
export function myBlueprint(o: BpOutline, q = ''): MyBpSection[] {
  const graphs: MyBpItem[] = []
  const functions: MyBpItem[] = []
  const macros: MyBpItem[] = []
  for (const g of o.graphs) {
    const item: MyBpItem = {
      key: `g:${g.name}`,
      name: g.name,
      section: 'graphs',
      graph: g.name,
      graphKind: g.kind,
      inputs: g.inputs,
      outputs: g.outputs,
      pure: g.pure,
      category: g.category,
      access: g.access,
      isConst: g.const,
    }
    if (g.kind === 'event' || g.name === CONSTRUCTION) graphs.push(item)
    else if (g.kind === 'function' || g.kind === 'interface') functions.push({ ...item, section: 'functions' })
    else if (g.kind === 'macro') macros.push({ ...item, section: 'macros' })
  }
  // 事件图在前、构造脚本在后（和 UE 一样）
  graphs.sort((a, b) => Number(a.graph === CONSTRUCTION) - Number(b.graph === CONSTRUCTION))
  const variables: MyBpItem[] = o.variables.map((v) => ({
    key: `v:${v.name}`,
    name: v.name,
    section: 'variables',
    type: v.type,
    editable: v.instanceEditable,
    replication: v.replication,
    category: v.category,
    inherited: v.inherited,
  }))
  const dispatchers: MyBpItem[] = o.dispatchers.map((d) => ({
    key: `d:${d.name}`,
    name: d.name,
    section: 'dispatchers',
    type: d.type,
    params: d.params,
    inherited: d.inherited,
  }))
  const keep = (list: MyBpItem[]) => list.filter((i) => hit(q, i.name, i.type))
  return [
    { id: 'graphs', items: keep(graphs) },
    { id: 'functions', items: keep(functions) },
    { id: 'macros', items: keep(macros) },
    { id: 'variables', items: keep(variables) },
    { id: 'dispatchers', items: keep(dispatchers) },
  ]
}

/**
 * 一组里按分类排（UE「我的蓝图」里函数、变量按 Category 分小组）：没分类（Default）的在前，其余按名字；
 * 同分类里自己的在前、继承的在后（UELink 已经这么排，这里保持稳定）。只有一个分类时返回一组，界面不画小标题
 */
export function byCategory(items: MyBpItem[]): [string, MyBpItem[]][] {
  const m = new Map<string, MyBpItem[]>()
  for (const i of items) {
    const c = i.category && i.category !== 'Default' ? i.category : ''
    m.set(c, [...(m.get(c) ?? []), i])
  }
  return [...m.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
}

/** 分发器签名写成一行：(Damage: Float, Instigator: Actor Object Reference)；没参数的写 () */
export const signature = (params?: BpParam[]) => `(${(params ?? []).map((p) => `${p.name}: ${p.type}`).join(', ')})`

/**
 * 引脚 / 变量类型的颜色（照 UE 的引脚配色，换成面板主题色名，toneColor 转成 var(--名)）：
 * 执行线前景色、布尔红、浮点绿、整数青、字符串类品红、结构体（向量、旋转、变换）琥珀、委托紫、对象引用主题色。
 * 类型文字是 UE 的 TypeToText（英文：Boolean、Float、Actor Object Reference、Array of Integers…）
 */
export function typeTone(type: string): string {
  if (type === 'exec') return 'fg'
  if (/bool/i.test(type)) return 'danger'
  if (/float|double|real/i.test(type)) return 'success'
  if (/integer|int64|byte/i.test(type)) return 'run'
  if (/delegate|dispatcher|event/i.test(type)) return 'ask'
  if (/vector|rotator|transform|struct|color|timeline|curve/i.test(type)) return 'warning'
  if (/string|name|text/i.test(type)) return 'peer'
  if (/object|class|reference|interface|actor|component/i.test(type)) return 'accent'
  return 'subtle'
}

/**
 * 中间可切的视图：图表（页签里开着的那些图）、类默认值（右栏 Actor 自身）、摘要与引用。
 * 视口去掉了（用户 2026-11-20：「Actor不显示视口，直接显示图表就行」）；以前记住的 'viewport' 读出来按图表处理
 */
export type BpView = 'graph' | 'defaults' | 'info'

/**
 * 实际显示哪个视图：记住的旧值 'viewport' 和不认识的值落到图表；不是 Actor 蓝图（函数库、动画蓝图，组件读出 null）时没有「类默认值」，也落到图表
 */
export function resolveView(want: string, hasActor: boolean | undefined): BpView {
  if (want !== 'graph' && want !== 'defaults' && want !== 'info') return 'graph'
  if (hasActor === false && want === 'defaults') return 'graph'
  return want
}

/** 图表页签：开着的图（按打开顺序），关掉一个后落到旁边那个；默认开事件图 */
export function openTab(tabs: string[], name: string): string[] {
  return tabs.includes(name) ? tabs : [...tabs, name]
}

export function closeTab(tabs: string[], name: string, active: string): { tabs: string[]; active: string } {
  const i = tabs.indexOf(name)
  if (i < 0) return { tabs, active }
  const next = tabs.filter((x) => x !== name)
  if (active !== name) return { tabs: next, active }
  return { tabs: next, active: next[Math.min(i, next.length - 1)] ?? '' }
}

/** 第一张事件图（没有就第一张图）：图表页的默认页签 */
export function defaultGraph(o?: BpOutline): string {
  if (!o) return ''
  return (o.graphs.find((g) => g.kind === 'event') ?? o.graphs[0])?.name ?? ''
}
