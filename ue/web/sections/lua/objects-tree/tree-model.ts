/**
 * Lua 对象树的数据（设计稿 designs/Lua对象页重设计-设计稿.md）：全局、绑定对象、模块合在一棵树里，分成固定几组；
 * 绑定对象按「Lua 类 / UE 类继承 / 归属」三种办法之一成树；搜索认类名（含子类）、对象名、模块名、全局名。
 * 这里只有纯函数（不读接口、不出文案），界面在 ObjectsTree.tsx，单测在 tree-model.test.ts
 */

/** UELink lua.objects 的一项；state、world、classChain、owner 是 2.19 起才有的 */
export interface BoundObj {
  path: string
  name: string
  class: string
  module: string
  state?: 'garbage' | 'noworld'
  world?: string
  map?: string
  /** 父类名，从直接父类一直到 Object */
  classChain?: string[]
  owner?: string
  ownerName?: string
  /** 2.19.1 起：这一项是类（UClass）不是实例 */
  isClass?: boolean
}

export type Grouping = 'module' | 'class' | 'owner'
export type StateFilter = 'all' | 'alive' | 'problem'
export type ObjState = 'alive' | 'garbage' | 'noworld'

export type NodeKind = 'module' | 'class' | 'world' | 'owner' | 'object' | 'global' | 'idle'

export interface TNode {
  key: string
  kind: NodeKind
  /** 显示的名字：模块名、类名、世界 id、对象名、全局名 */
  name: string
  obj?: BoundObj
  /** 下面一共有多少个对象（分组节点用） */
  count?: number
  children: TNode[]
}

export const stateOf = (o: BoundObj): ObjState => o.state ?? 'alive'

/** 带 . [ : 的才当 Lua 路径（GameSystemManager.Bag、package.loaded["UI.Bag"]、对象名:字段） */
export const isPathQuery = (q: string) => /[.[\]:]/.test(q.trim())

/** 类名比较时不分大小写、蓝图类省掉 _C、C++ 类可以带也可以不带 U / A 前缀 */
const normClass = (s: string) => s.toLowerCase().replace(/_c$/, '')
const sameClass = (name: string, q: string) => {
  const a = normClass(name)
  const b = normClass(q)
  return a === b || (/^[ua]/.test(a) && a.slice(1) === b) || (/^[ua]/.test(b) && b.slice(1) === a)
}

/** 对象的类和全部父类（自己的类在最前） */
export const classesOf = (o: BoundObj) => [o.class, ...(o.classChain ?? [])]

/** 对象是不是这个类或它的子类（按类名搜「含子类」） */
export const isA = (o: BoundObj, cls: string) => classesOf(o).some((c) => sameClass(c, cls))

/** 搜索命中的类名：对象的类链里名字包含关键词的最上面那个（「BP_Char」命中 BP_CharacterBase_C 而不是它的子类） */
export function matchedClass(o: BoundObj, q: string): string | undefined {
  const k = q.trim().toLowerCase()
  if (!k) return undefined
  const hits = classesOf(o).filter((c) => c.toLowerCase().includes(k))
  return hits[hits.length - 1]
}

export function filterState(objs: BoundObj[], f: StateFilter) {
  if (f === 'all') return objs
  return objs.filter((o) => (stateOf(o) === 'alive') === (f === 'alive'))
}

const byName = (a: TNode, b: TNode) => a.name.localeCompare(b.name)
const objNode = (o: BoundObj): TNode => ({ key: `o:${o.path}`, kind: 'object', name: o.name, obj: o, children: [] })
const total = (n: TNode): number => (n.kind === 'object' ? 1 : 0) + n.children.reduce((s, c) => s + total(c), 0)
const withCount = (n: TNode): TNode => {
  const children = n.children.map(withCount)
  return { ...n, children, count: n.kind === 'object' ? undefined : total({ ...n, children }) }
}

/** 按 Lua 类（模块）：模块下挂它的实例；没认出模块的放最后 */
export function byModule(objs: BoundObj[]): TNode[] {
  const m = new Map<string, BoundObj[]>()
  for (const o of objs) m.set(o.module, [...(m.get(o.module) ?? []), o])
  return [...m]
    .map(([mod, list]) => ({
      key: `m:${mod}`,
      kind: 'module' as const,
      name: mod,
      count: list.length,
      children: list.map(objNode).sort(byName),
    }))
    .sort((a, b) => (!a.name ? 1 : !b.name ? -1 : byName(a, b)))
}

/**
 * 按 UE 类继承：每个对象按「最上层父类 → … → 自己的类」挂进一棵类树。
 * from 给了时（按类名搜），每个对象从它类链里的 from 那一层开始挂，树根就是搜到的类。
 * 树根往下只有一条路、又没有直接实例的那几层（Object → Actor → Pawn）收掉，从第一个分叉或有实例的类开始显示
 */
export function byClass(objs: BoundObj[], from?: (o: BoundObj) => string | undefined): TNode[] {
  const root: TNode = { key: 'c:', kind: 'class', name: '', children: [] }
  const index = new Map<string, TNode>()
  for (const o of objs) {
    let chain = [...classesOf(o)].reverse()
    const start = from?.(o)
    if (start) chain = chain.slice(Math.max(0, chain.indexOf(start)))
    let at = root
    for (const c of chain) {
      const key = `${at.key}/${c}`
      let n = index.get(key)
      if (!n) {
        n = { key, kind: 'class', name: c, children: [] }
        index.set(key, n)
        at.children.push(n)
      }
      at = n
    }
    at.children.push(objNode(o))
  }
  let top = root
  while (!from && top.children.length === 1) {
    const only = top.children[0]
    if (only.kind !== 'class' || only.children.length !== 1 || only.children[0].kind !== 'class') break
    top = only
  }
  const sort = (n: TNode): TNode => ({
    ...n,
    children: n.children
      .map(sort)
      .sort((a, b) => (a.kind === b.kind ? byName(a, b) : a.kind === 'class' ? -1 : 1)),
  })
  return sort(top).children.map(withCount)
}

/**
 * 按归属：世界 → 外层的 Actor 或控件 → 它下面的对象。外层没绑 Lua 时补一个「外层」节点（只当分组，不能检视）；
 * 世界已关的对象单独成「已关的世界」一组（world 为空）。外层链按理是树，但数据不保证，成环的那个当根
 */
export function byOwner(objs: BoundObj[]): TNode[] {
  const byPath = new Map(objs.map((o) => [o.path, o]))
  const nodes = new Map<string, TNode>(objs.map((o) => [o.path, objNode(o)]))
  const extra = new Map<string, TNode>()
  const parentOf = (o: BoundObj) => (o.owner && o.owner !== o.path ? o.owner : undefined)
  // 往上走会绕回自己的，从自己断开
  const cyclic = (o: BoundObj) => {
    const seen = new Set([o.path])
    let p = parentOf(o)
    while (p) {
      if (seen.has(p)) return true
      seen.add(p)
      const up = byPath.get(p)
      p = up ? parentOf(up) : undefined
    }
    return false
  }
  const worlds = new Map<string, TNode>()
  const worldOf = (o: BoundObj) => {
    const id = o.world ?? ''
    let w = worlds.get(id)
    if (!w) {
      w = { key: `w:${id}`, kind: 'world', name: id, children: [] }
      worlds.set(id, w)
    }
    return w
  }
  for (const o of objs) {
    const n = nodes.get(o.path)!
    const p = cyclic(o) ? undefined : parentOf(o)
    if (p && nodes.has(p)) nodes.get(p)!.children.push(n)
    else if (p) {
      let g = extra.get(p)
      if (!g) {
        g = { key: `w:${o.world ?? ''}/owner:${p}`, kind: 'owner', name: o.ownerName || p.split(/[.:]/).pop() || p, children: [] }
        extra.set(p, g)
        worldOf(o).children.push(g)
      }
      g.children.push(n)
    } else worldOf(o).children.push(n)
  }
  const sort = (n: TNode): TNode => ({ ...n, children: n.children.map(sort).sort(byName) })
  // 活着的世界在前，已关的世界（id 为空）最后
  return [...worlds.values()]
    .sort((a, b) => (!a.name ? 1 : !b.name ? -1 : a.name.localeCompare(b.name)))
    .map((w) => withCount(sort(w)))
}

export function groupObjects(objs: BoundObj[], g: Grouping): TNode[] {
  return g === 'module' ? byModule(objs) : g === 'class' ? byClass(objs) : byOwner(objs)
}

/** 搜索的结果：按类（含子类，一棵类树）、按名字的对象、模块、全局；path 为真时还给「按 Lua 路径打开」 */
export interface SearchResult {
  classes: TNode[]
  objects: TNode[]
  modules: string[]
  globals: string[]
  classHits: number
}

export function search(q: string, objs: BoundObj[], modules: string[], globals: string[]): SearchResult {
  const k = q.trim().toLowerCase()
  const byCls = objs.filter((o) => matchedClass(o, k))
  const inCls = new Set(byCls.map((o) => o.path))
  const named = objs.filter((o) => !inCls.has(o.path) && o.name.toLowerCase().includes(k))
  return {
    classes: byClass(byCls, (o) => matchedClass(o, k)),
    objects: named.map(objNode).sort(byName),
    modules: modules.filter((m) => m.toLowerCase().includes(k)).sort(),
    globals: globals.filter((g) => g.toLowerCase().includes(k)).sort(),
    classHits: byCls.length,
  }
}

/** 一个类节点（或模块节点）下面的全部对象 */
export function objectsUnder(n: TNode): BoundObj[] {
  return n.kind === 'object' ? [n.obj!] : n.children.flatMap(objectsUnder)
}

/** 没有绑定对象的模块（「只加载、没有对象的模块」那一组） */
export function idleModules(modules: string[], objs: BoundObj[]) {
  const used = new Set(objs.map((o) => o.module))
  return modules.filter((m) => !used.has(m)).sort()
}

/**
 * 函数的定义位置 → 文件和行：`[string "C:/x/A.lua"]:26`、`@C:/x/A.lua:26`、`...Script/A.lua:26`、`A.lua:26`。
 * 认不出时原样放 file、没有 line
 */
export function parseSrc(src: string): { file: string; line?: number } {
  const m = /^(?:\[string "(.+?)"\]|@?(.+?)):(\d+)$/.exec(src.trim())
  if (!m) return { file: src }
  return { file: (m[1] ?? m[2]).replace(/\\/g, '/'), line: Number(m[3]) }
}

/** 只留文件名（BP_PlayerController_C.lua），完整路径放悬停提示 */
export const baseName = (f: string) => f.replace(/\\/g, '/').split('/').pop() ?? f

/**
 * 对象表里也有类（UClass）：Lua 里 UE.UClass.Load、拿蓝图类做参数时 UnLua 也会给类建实例表。
 * 它们不是「运行中的对象」，拿它当 self 调实例函数会报「需要 UserWidget，拿到的是 WidgetBlueprintGeneratedClass」
 */
export const isClassObj = (o: BoundObj) => !!o.isClass || o.class === 'Class' || /GeneratedClass$/.test(o.class)

/**
 * 调带 self 的函数时，该拿谁当 self：看的是模块表（package.loaded.X）时是绑这个模块的对象，
 * 看的是类对象时是这个类的实例。看的本来就是实例时返回 undefined（就用它自己）
 */
export function selfCandidates(
  root: { path: string; keys: (string | number)[] },
  objs: BoundObj[],
  obj?: BoundObj,
): { why: 'module' | 'class'; cands: BoundObj[] } | undefined {
  const live = objs.filter((o) => stateOf(o) === 'alive' && !isClassObj(o))
  if (!root.path && root.keys.length === 3 && root.keys[0] === 'package' && root.keys[1] === 'loaded') {
    const m = String(root.keys[2])
    return { why: 'module', cands: live.filter((o) => o.module === m) }
  }
  if (root.path && !root.keys.length && obj && isClassObj(obj)) {
    return { why: 'class', cands: live.filter((o) => isA(o, obj.name)) }
  }
  return undefined
}

export interface ChainItem {
  name: string
  kind?: 'lua' | 'ue'
  src?: string
  path?: string
  /** UELink 2.19.1 起：按反射补上的父类，没有函数 */
  reflected?: boolean
}

/**
 * 继承链给人看的样子，下标和原数组一一对应（函数分组按下标对层）：
 * 资源路径只留类名（完整路径放 path）；同一个名字第二次出现起标 dup（UELink 2.19.0 遇到「元表是自己」会把同一层重复十几次）；
 * 没认出名字、但函数定义在「模块名最后一段.lua」里的那层就是这个模块
 */
export function tidyChain<T extends ChainItem>(chain: T[], module?: string): (T & { dup?: boolean })[] {
  const seen = new Set<string>()
  const tail = module?.split('.').pop()?.toLowerCase()
  return chain.map((c) => {
    let x: T & { dup?: boolean } = c
    if (!x.name && tail && x.src && baseName(parseSrc(x.src).file).toLowerCase() === `${tail}.lua`)
      x = { ...x, name: module!, kind: 'lua' }
    if (x.name.startsWith('/') && x.name.includes('.')) x = { ...x, path: x.path ?? x.name, name: x.name.split('.').pop()! }
    if (x.name && seen.has(x.name)) return { ...x, dup: true }
    if (x.name) seen.add(x.name)
    return x
  })
}

/**
 * 实例表自己身上的 C 函数是 UnLua 第一次调 UE 函数时缓存的包装（UELink 2.19.1 起服务端已经归好），
 * 旧版这边补一下：归到第一层 UE 类，免得调一次就从 UE 那组跳到「自己的」
 */
export function regroupFns<F extends { from: number; src?: string }>(fns: F[], chain: ChainItem[]): F[] {
  const ue = chain.findIndex((c) => c.kind === 'ue' || (!!c.name && c.name.startsWith('/')))
  if (ue < 0) return fns
  return fns.map((f) => (f.from === 0 && !f.src ? { ...f, from: ue + 1 } : f))
}
