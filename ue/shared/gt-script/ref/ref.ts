import type { GtRef, GtRefIn, GtRefLike, GtTarget } from './types.ts'

/**
 * 引用的三种写法（协议第 1 节）：`"shop"`（场景顶层 objects 里的命名引用）、`{class, …}`（内联）、`"$var"`（这次运行里
 * obj.find / saveAs 拿到的对象）。部件写法 target（第 2 节）：`{obj, part?, slate?}`，也接受直接写一个引用。
 * 这里只认形状、取名字、规整 target；校验在 validate.ts，人话描述在 describe.ts。
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export type RefForm = 'name' | 'var' | 'inline'

/** 哪种写法；都不是（数字、数组、没有 class 的对象）返回 undefined */
export function refForm(v: unknown): RefForm | undefined {
  if (typeof v === 'string') return v.startsWith('$') ? 'var' : v ? 'name' : undefined
  if (isObj(v) && typeof v.class === 'string') return 'inline'
  return undefined
}

export const isRefLike = (v: unknown): v is GtRefLike => refForm(v) !== undefined

/** 命名引用的定义（objects 里的内联引用）；不是名字或找不到时 undefined */
export function namedRef(objects: unknown, name: unknown): GtRef | undefined {
  if (typeof name !== 'string' || name.startsWith('$') || !isObj(objects)) return undefined
  const v = objects[name]
  return isObj(v) && typeof v.class === 'string' ? (v as GtRef) : undefined
}

/** 引用最后落到的内联定义：名字查 objects，`$var` 运行时才知道（undefined） */
export const inlineOf = (ref: unknown, objects?: unknown): GtRef | undefined =>
  refForm(ref) === 'inline' ? (ref as GtRef) : refForm(ref) === 'name' ? namedRef(objects, ref) : undefined

/** in 是对象写法（另一个对象里的容器 / Actor 的组件） */
export const inObj = (v: unknown): GtRefIn | undefined =>
  isObj(v) && 'obj' in v ? (v as unknown as GtRefIn) : undefined

/**
 * 规整 target：`{obj, part?, slate?}` 原样；直接写的引用 = `{obj: 它}`。字符串选择器（v3 的 `WBP_X:Root/Btn`）不是引用，
 * 但字符串也可能是命名引用——分不出来的交给校验（看 objects 里有没有、写法像不像选择器）
 */
export function toTarget(v: unknown): GtTarget | undefined {
  if (isObj(v) && 'obj' in v && isRefLike(v.obj)) return v as unknown as GtTarget
  if (isRefLike(v)) return { obj: v }
  return undefined
}

/** v3 选择器的样子（屏名冒号、路径斜杠、嵌套 >、方括号、#类名、@句柄）：v4 报 selector_removed */
export const looksLikeSelector = (s: string) => /[:/>[\]#=]|^@|^\*/.test(s) || s === '.'

/** 类名规整成比较用的键：去掉 `_C` 后缀、资源路径只留最后一段、`U` / `A` 前缀可省（协议第 1 节）、忽略大小写 */
export function classKey(cls: string) {
  let c = cls.trim().split(/[/.]/).filter(Boolean).at(-1) ?? ''
  if (/_C$/i.test(c)) c = c.slice(0, -2)
  if (/^[UA][A-Z]/.test(c)) c = c.slice(1)
  return c.toLowerCase()
}

/** 显示用的短类名：`/Game/UI/WBP_Shop.WBP_Shop_C` → `WBP_Shop` */
export function shortClass(cls: string) {
  const c = cls.trim().split(/[/.]/).filter(Boolean).at(-1) ?? cls
  return c.replace(/_C$/i, '')
}

/** 像组件类（没给 in 时报 ref_need_owner）；只看名字，不准的交给编辑器里的校验 */
export const looksLikeComponent = (cls: string) => /Component$/i.test(shortClass(cls))
/** 像子系统（ident 必须为空） */
export const looksLikeSubsystem = (cls: string) => /Subsystem$/i.test(shortClass(cls))

/** 部件写法：`Header.BtnClose`，每段是设计器里的控件名（Actor 时是组件名） */
export const validPart = (part: string) =>
  // 名字里可以嵌 $变量（按文字替换，`Claim_$what`）
  part.split('.').every((x) => /^[A-Za-z_一-鿿$][\w一-鿿$-]*$/.test(x))

/** Slate 段：`类型[text=子串][序号]`，多段 `/` */
export const validSlate = (s: string) =>
  s.split('/').every((x) => /^[A-Za-z_]\w*(\[text=[^\]]*\])?(\[\d+\])?$/.test(x.trim()))

/**
 * 命名引用之间的依赖：objects 里每个引用的 in.obj、near（任意深度的内联里）用到的名字。
 * in 不能成环（A 在 B 里、B 又在 A 里），返回成环的一圈名字（ref_cycle），没有返回 undefined
 */
export function refDeps(ref: unknown, out: string[] = []): string[] {
  const r = isObj(ref) ? ref : undefined
  if (!r) return out
  const visit = (v: unknown) => {
    if (refForm(v) === 'name') out.push(v as string)
    else if (refForm(v) === 'inline') refDeps(v, out)
  }
  const i = inObj(r.in)
  if (i) visit(i.obj)
  if (r.near !== undefined && !Array.isArray(r.near)) visit(r.near)
  return out
}

export function findRefCycle(objects: unknown): string[] | undefined {
  if (!isObj(objects)) return undefined
  const state = new Map<string, 'open' | 'done'>()
  const walk = (name: string, chain: string[]): string[] | undefined => {
    if (state.get(name) === 'done') return undefined
    if (state.get(name) === 'open') return [...chain.slice(chain.indexOf(name)), name]
    state.set(name, 'open')
    for (const dep of refDeps(objects[name])) {
      if (!(dep in objects)) continue
      const hit = walk(dep, [...chain, name])
      if (hit) return hit
    }
    state.set(name, 'done')
    return undefined
  }
  for (const name of Object.keys(objects)) {
    const hit = walk(name, [])
    if (hit) return hit
  }
  return undefined
}
