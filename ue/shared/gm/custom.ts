import type { GmCustom, GmCustomObj, GmMany, GmRef } from './schema.ts'

/**
 * 自定义 GM → GameTest 的调用参数（规格第 8 节「执行」）。网页（GM 页执行、对象调用的调函数）和服务端（ue_gm run、宏）
 * 都用这一份，拼法只有一处：custom.objects 作为 gt.step 的 objects，步骤是
 * `{action:"obj.call", obj:{"$obj": obj}, function, part, args, each}`；many=first 给目标对象的引用加 many:"first"，
 * many=each 让 obj.call 带 each:true（命中多个时每个都调，payload.invoke 变数组）。
 */

/** gt.step 的 objects 参数：名字 → 引用或来源字符串 */
export type GtObjects = Record<string, GmRef | string>

/** 对象参数的写法：`{"$obj": 名字}` */
export const objArg = (name: string) => ({ $obj: name })
export const isObjArg = (v: unknown): v is { $obj: string } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { $obj?: unknown }).$obj === 'string'

/** 一个对象条目在 gt.step objects 里的值：来源字符串原样，引用拷一份（加 many 不改到原数据） */
export const objValue = (o: GmCustomObj): GmRef | string => (o.src ? o.src : { ...(o.ref as GmRef) })

/** 执行时的参数：存的 args 上叠用户这次改的（只认 editable 里的，别的改了抛错，ue_gm run 原样告诉 Agent） */
export function mergeArgs(c: Pick<GmCustom, 'args' | 'editable' | 'name'>, override?: Record<string, unknown>) {
  const out = { ...c.args }
  for (const [k, v] of Object.entries(override ?? {})) {
    if (!c.editable.includes(k))
      throw new Error(
        c.editable.length
          ? `自定义 GM「${c.name}」的参数 ${k} 执行时不能改；能改的：${c.editable.join('、')}`
          : `自定义 GM「${c.name}」的参数执行时都不能改；要改就用 ue_gm save 改它存的参数`,
      )
    out[k] = v
  }
  return out
}

/** 参数里用到的对象名（对象参数 `{"$obj": 名}`） */
export const objNamesInArgs = (args: Record<string, unknown>) =>
  Object.values(args)
    .filter(isObjArg)
    .map((v) => v.$obj)

/** GameTest 对象名的规则：字母、数字、下划线或中文，不以数字开头（gt.validate 照这个拦） */
const GT_NAME = /^[A-Za-z_\p{Script=Han}][\w\p{Script=Han}]*$/u

/**
 * 对象列表的名字 → GameTest 认的名字。对象列表的名字随便起（选 Lua 类时默认就是 `lua:BP_Game`），
 * 交给 gt.step / gt.validate 前把不合规则的字符换成 _，数字开头的前面加 _，换完撞名的加 _2、_3
 */
export function gtNames(names: string[]) {
  const out = new Map<string, string>()
  const used = new Set(names.filter((n) => GT_NAME.test(n)))
  for (const n of names) {
    if (out.has(n)) continue
    if (GT_NAME.test(n)) {
      out.set(n, n)
      continue
    }
    let base = n.replace(/[^\w\p{Script=Han}]/gu, '_')
    if (!base || /^\d/.test(base)) base = `_${base}`
    let id = base
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`
    used.add(id)
    out.set(n, id)
  }
  return out
}

/** 调函数：gt.step 的完整参数 */
export function callStep(
  c: Pick<GmCustom, 'obj' | 'objects' | 'function' | 'part' | 'args' | 'many'>,
  args: Record<string, unknown> = c.args,
) {
  if (!c.objects[c.obj]) throw new Error(`对象「${c.obj}」不在这条 GM 的 objects 里`)
  for (const n of objNamesInArgs(args))
    if (!c.objects[n]) throw new Error(`参数里用到的对象「${n}」不在这条 GM 的 objects 里`)
  // 名字换成 GameTest 认的（lua:BP_Game → lua_BP_Game），步骤和参数里的引用跟着换
  const id = gtNames(Object.keys(c.objects))
  const objects: GtObjects = {}
  for (const [name, o] of Object.entries(c.objects)) objects[id.get(name)!] = objValue(o)
  const tid = id.get(c.obj)!
  const target = objects[tid]
  if (c.many === 'first' && typeof target === 'object') objects[tid] = { ...target, many: 'first' }
  const gtArgs = Object.fromEntries(
    Object.entries(args).map(([k, v]) => [k, isObjArg(v) ? objArg(id.get(v.$obj)!) : v]),
  )
  const step: Record<string, unknown> = {
    action: 'obj.call',
    obj: objArg(tid),
    function: c.function ?? '',
    args: gtArgs,
  }
  if (c.part) step.part = c.part
  if (c.many === 'each') step.each = true
  return { step, objects }
}

/**
 * 取对象（kind=get）：gt.resolve 一次拿命中的每个实例和这些属性此刻的值（show）。
 * show 要写在 refs 的每一项里（协议 gt.resolve：refs: [{id, ref, show}]），写在外层 GameTest 不认、属性值不回来。
 * 来源字符串（@pawn）不是匹配规则，gt.resolve 不认，直接报错说明
 */
export function getQuery(c: Pick<GmCustom, 'obj' | 'objects' | 'props'>) {
  const o = c.objects[c.obj]
  if (!o) throw new Error(`对象「${c.obj}」不在这条 GM 的 objects 里`)
  if (!o.ref) throw new Error(`「${c.obj}」是来源 ${o.src}，取对象只支持匹配规则`)
  return { refs: [{ id: c.obj, ref: o.ref, show: c.props ?? [] }] }
}

/** gt.step 的结果里 obj.call 的报告：each 时是数组，统一成数组 */
export interface InvokeReport {
  object?: string
  function?: string
  args?: unknown
  returned?: unknown
  /** GameTest 2.2.1 起：带类型的返回值（对象 {$obj, class, name}，数组 / 表保留层级，截断的写 $more） */
  value?: unknown
  ms?: number
  [k: string]: unknown
}
export function invokesOf(res: unknown): InvokeReport[] {
  const inv = (res as { payload?: { invoke?: unknown } } | undefined)?.payload?.invoke
  if (!inv) return []
  return (Array.isArray(inv) ? inv : [inv]) as InvokeReport[]
}

/**
 * gt.step 成功与否只看结构化字段（规格第 7 节：不按文字判断）。顶层的 ok 不能用：UELink 的 Dispatch
 * 对操作本身成功的回包一律把 ok 写成 true，步骤没通过（断言不过、找不到对象）也是 ok=true，
 * 这一步的结论在 GameTest 的 succeeded（整次临时运行）和 status（最后一步：succeeded / already / failed…）。
 * 两个都没有（旧版、假桥接）才退回看 ok
 */
const PASSED = new Set(['passed', 'succeeded', 'already'])
export const stepOk = (res: unknown) => {
  const r = res as { ok?: boolean; status?: string; succeeded?: boolean } | undefined
  if (!r) return false
  if (typeof r.succeeded === 'boolean') return r.succeeded
  if (typeof r.status === 'string' && r.status) return PASSED.has(r.status)
  return r.ok === true
}

/** 「会执行」的一句话：在 商店界面 上调 BuyItem(2003, 1, 店主) */
export function callText(c: Pick<GmCustom, 'obj' | 'function' | 'kind' | 'props'>, args: Record<string, unknown>) {
  if (c.kind === 'get') return `取 ${c.obj} 的 ${(c.props ?? []).join(', ') || '全部命中实例'}`
  const vals = Object.values(args).map((v) => (isObjArg(v) ? v.$obj : typeof v === 'string' ? v : JSON.stringify(v)))
  return `在 ${c.obj} 上调 ${c.function ?? ''}(${vals.join(', ')})`
}

/** 新 id：短、在这份文件里不重复 */
export function newCustomId(taken: Iterable<string>) {
  const have = new Set(taken)
  for (;;) {
    const id = `c${Math.random().toString(36).slice(2, 6)}`
    if (!have.has(id)) return id
  }
}

export type { GmMany }
