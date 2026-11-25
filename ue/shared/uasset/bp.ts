/**
 * 蓝图的结构（设计文档第 4.4 节）：父类、接口、变量、组件树、图表、控件树。全部来自带标签的属性和图表节点的引脚：
 * - 组件：C++ 父类的组件 = CDO 下面的子对象（只有这个蓝图改过的属性）；这个蓝图加的 = SCS 节点 + 组件模板；
 *   父蓝图的组件在这里改过 = InheritableComponentHandler 的记录。
 * - 控件树：WidgetTree 的 RootWidget，往下顺着面板的 Slots[].Content 走。
 */
import { childrenOf, objAt, shortName, type Asset } from './asset.ts'
import { readGraph, type GGraph } from './graph.ts'
import { prop, type UObj } from './objects.ts'

export interface BpComp {
  name: string
  obj: UObj
  parent: string
  source: 'native' | 'scs' | 'inherited'
  class: string
}

export interface BpVar {
  name: string
  type: string
  category: string
  flags: string[]
  defaultValue: string
  friendlyName: string
}

export interface BpWidget {
  obj: UObj
  path: string
  parent: string
  slot?: UObj
}

export interface Bp {
  bp: UObj
  /** 生成类 X_C 和它的类默认对象 Default__X_C */
  gen?: UObj
  cdo?: UObj
  parent: string
  interfaces: string[]
  variables: BpVar[]
  components: BpComp[]
  graphs: GGraph[]
  widgets: BpWidget[]
}

/** 是不是蓝图：资源本体有 ParentClass / GeneratedClass 这类蓝图才有的属性，或者类名以 Blueprint 结尾 */
export const isBlueprint = (a: Asset) =>
  !!a.main && (/Blueprint$/.test(a.main.class) || prop(a.main, 'ParentClass') !== undefined)

// 变量标志（EPropertyFlags）
const CPF_BLUEPRINT_READ_ONLY = 0x10n
const CPF_NET = 0x20n
const CPF_DISABLE_EDIT_ON_INSTANCE = 0x10000n
const CPF_REP_NOTIFY = 0x100000000n
const CPF_EXPOSE_ON_SPAWN = 0x0001000000000000n

function varFlags(raw: unknown): string[] {
  let f = 0n
  try {
    f = BigInt(typeof raw === 'string' || typeof raw === 'number' ? raw : 0)
  } catch {
    f = 0n
  }
  const out: string[] = []
  if (f & CPF_NET) out.push(f & CPF_REP_NOTIFY ? 'repNotify' : 'replicated')
  if (!(f & CPF_DISABLE_EDIT_ON_INSTANCE)) out.push('instanceEditable')
  if (f & CPF_EXPOSE_ON_SPAWN) out.push('exposeOnSpawn')
  if (f & CPF_BLUEPRINT_READ_ONLY) out.push('readOnly')
  return out
}

const rec = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const list = (v: unknown) => (Array.isArray(v) ? v : [])

export function readBlueprint(a: Asset): Bp | undefined {
  const bp = a.main
  if (!bp || !isBlueprint(a)) return undefined
  const gen = objAt(a, prop(bp, 'GeneratedClass')) ?? a.objs.find((o) => o.outer === 0 && o.name === `${bp.name}_C`)
  const cdo = a.objs.find((o) => o.isCdo && o.outer === 0)
  const interfaces = list(prop(bp, 'ImplementedInterfaces')).map((x) => String(rec(x).interface ?? ''))
  const variables: BpVar[] = list(prop(bp, 'NewVariables')).map((x) => {
    const v = rec(x)
    return {
      name: String(v.varName ?? ''),
      type: String(v.varType ?? ''),
      category: String(v.category ?? ''),
      flags: varFlags(v.propertyFlags),
      defaultValue: String(v.defaultValue ?? ''),
      friendlyName: String(v.friendlyName ?? ''),
    }
  })
  return {
    bp,
    gen,
    cdo,
    parent: String(prop(bp, 'ParentClass') ?? ''),
    interfaces: interfaces.filter(Boolean),
    variables,
    components: components(a, bp, gen, cdo),
    graphs: graphs(a, bp),
    widgets: widgets(a, bp),
  }
}

function components(a: Asset, bp: UObj, gen?: UObj, cdo?: UObj): BpComp[] {
  const out: BpComp[] = []
  if (cdo) {
    for (const c of childrenOf(a, cdo).sort((x, y) => x.name.localeCompare(y.name))) {
      const attach = shortName(prop(c, 'AttachParent'))
      out.push({ name: c.name, obj: c, parent: attach, source: 'native', class: c.class })
    }
  }
  const scs = objAt(a, prop(bp, 'SimpleConstructionScript'))
  const addNode = (n: UObj | undefined, parent: string, depth: number) => {
    if (!n || depth > 32) return
    const name = String(prop(n, 'InternalVariableName') ?? n.name)
    const tpl = objAt(a, prop(n, 'ComponentTemplate'))
    if (tpl) out.push({ name, obj: tpl, parent, source: 'scs', class: tpl.class })
    for (const c of list(prop(n, 'ChildNodes'))) addNode(objAt(a, c), name, depth + 1)
  }
  if (scs) {
    for (const r of list(prop(scs, 'RootNodes'))) {
      const n = objAt(a, r)
      const p = n ? String(prop(n, 'ParentComponentOrVariableName') ?? '') : ''
      addNode(n, p === 'None' ? '' : p, 0)
    }
  }
  const ich = objAt(a, gen && prop(gen, 'InheritableComponentHandler'))
  if (ich) {
    const tpls = list(prop(ich, 'Records'))
      .map((r) => objAt(a, rec(r).componentTemplate))
      .filter((x): x is UObj => !!x)
      .sort((x, y) => x.name.localeCompare(y.name))
    for (const tpl of tpls)
      out.push({
        name: tpl.name.replace(/_GEN_VARIABLE$/, ''),
        obj: tpl,
        parent: '',
        source: 'inherited',
        class: tpl.class,
      })
  }
  return out
}

function graphs(a: Asset, bp: UObj): GGraph[] {
  const kinds = new Map<string, string>()
  const mark = (v: unknown, kind: string) => {
    for (const p of list(v)) if (typeof p === 'string' && !kinds.has(p)) kinds.set(p, kind)
  }
  mark(prop(bp, 'UbergraphPages'), 'event')
  mark(prop(bp, 'FunctionGraphs'), 'function')
  mark(prop(bp, 'MacroGraphs'), 'macro')
  mark(prop(bp, 'DelegateSignatureGraphs'), 'delegate')
  for (const i of list(prop(bp, 'ImplementedInterfaces'))) mark(rec(i).graphs, 'interface')
  const out: GGraph[] = []
  for (const [p, kind] of kinds) {
    const g = a.byPath.get(p)
    if (g) out.push(readGraph(a, g, kind))
  }
  // 子图（折叠的图、动画状态机里的图）：外层是蓝图下面的对象、类名以 Graph 结尾、上面没列到的
  for (const o of a.objs)
    if (/Graph$/.test(o.class) && !kinds.has(o.path) && o.outer !== 0 && o.class !== 'WidgetTree')
      out.push(readGraph(a, o, 'sub'))
  return out
}

function widgets(a: Asset, bp: UObj): BpWidget[] {
  const tree = objAt(a, prop(bp, 'WidgetTree'))
  const root = tree && objAt(a, prop(tree, 'RootWidget'))
  if (!root) return []
  const out: BpWidget[] = []
  const seen = new Set<number>()
  const visit = (w: UObj, path: string, parent: string, slot?: UObj) => {
    if (seen.has(w.ref) || out.length > 4000) return
    seen.add(w.ref)
    out.push({ obj: w, path, parent, slot })
    for (const s of list(prop(w, 'Slots'))) {
      const so = objAt(a, s)
      const kid = so && objAt(a, prop(so, 'Content'))
      if (kid) visit(kid, `${path}/${kid.name}`, path, so)
    }
  }
  visit(root, root.name, '')
  return out.sort((x, y) => x.path.localeCompare(y.path))
}
