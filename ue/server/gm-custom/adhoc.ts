import { z } from 'zod'
import { callText, isObjArg, objNamesInArgs, SET_VALUE } from '../../shared/gm/custom.ts'
import { GmCustom, type GmCustomObj, type GmObject } from '../../shared/gm/schema.ts'
import type { OpCtx } from '../ops.ts'
import { c } from '../util.ts'
import { GM_RECENT_EVENT, pushGmRecent, readGm } from '../store.ts'
import { runCustomDef } from './run.ts'

/**
 * ue_gm action=call：临时调一次对象函数 / 取值 / 改值，不存成 GM（用户 2026-11-25：Agent 要能直接拿对象列表里的对象用）。
 * def 和 save kind=gm 的写法一样，只是不用 name / module，objects 也能省：obj 和参数里的 {"$obj": 名} 按对象列表的名字现找，
 * obj 也可以直接写匹配规则（{class, ident…}，class 可写 lua:模块名，纯 Lua 实例也认）或来源字符串（@pawn、@sub.X、@luaMod.X）。
 * 拼好后走 runCustomDef，和 GM 页、自定义 GM 同一条执行路径（gt.step，按运行时权限）。
 * obj 是对象列表里的名字时记进 GM 页对象调用的「调用记录」，用户能看到 Agent 调过什么、点一下填回工作台
 */
type Obj = Record<string, unknown>

/** 临时 GM 的 obj 是内联规则时用的名字（只在这次调用里有效） */
const INLINE = '对象'

const isPlain = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

const copyObj = (o: GmObject): GmCustomObj => (o.src ? { src: o.src } : { ref: { ...o.ref! } })

function kindOf(def: Obj) {
  if (def.kind) return def.kind
  if (def.prop !== undefined) return 'set'
  if (Array.isArray(def.props)) return 'get'
  return 'call'
}

/** def → 一条不存盘的自定义 GM：对象从 def.objects、对象列表里取，内联规则和来源字符串直接用 */
export function adhocDef(def: Obj, library: GmObject[]): { gm: GmCustom; libObj?: string } {
  const objects: Record<string, GmCustomObj> = {}
  if (isPlain(def.objects)) for (const [n, o] of Object.entries(def.objects)) objects[n] = o as GmCustomObj
  let obj = def.obj
  let libObj: string | undefined
  if (isPlain(obj)) {
    objects[INLINE] = { ref: obj as GmCustomObj['ref'] }
    obj = INLINE
  } else if (typeof obj === 'string' && obj.startsWith('@') && !library.some((o) => o.name === obj)) {
    objects[obj] = { src: obj }
  } else if (typeof obj !== 'string' || !obj.trim()) {
    throw new Error('def.obj 要写对象列表里的对象名、匹配规则 {class, ident…} 或来源字符串（@pawn、@sub.X、@luaMod.X）')
  }
  const name = String(obj)
  const args: Obj = isPlain(def.args) ? { ...def.args } : {}
  const kind = kindOf(def)
  // 改值时 value 可以写在 def 上，和 args.value 一样
  if (kind === 'set' && def.value !== undefined && !(SET_VALUE in args)) args[SET_VALUE] = def.value
  for (const n of [name, ...objNamesInArgs(args)]) {
    if (objects[n]) continue
    const o = library.find((x) => x.name === n)
    if (!o)
      throw new Error(
        `对象列表里没有「${n}」：ue_gm action=list source=custom 看 objects，先 ue_gm save kind=object 加进去，或 obj 直接写匹配规则`,
      )
    objects[n] = copyObj(o)
    if (n === name) libObj = n
  }
  let gm: GmCustom
  try {
    gm = GmCustom.parse({
      ...def,
      id: 'adhoc',
      name: `${name}`,
      module: 'adhoc',
      kind,
      obj: name,
      objects,
      args,
    })
  } catch (e) {
    const msg =
      e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}：${i.message}`).join('；') : String(e)
    throw new Error(`def 不合写法：${msg}`)
  }
  if (gm.kind === 'call' && !gm.function) throw new Error('调函数要写 function（取值写 props，改值写 prop + value）')
  if (gm.kind === 'set' && !(SET_VALUE in gm.args)) throw new Error('改值要写 value（新值）')
  return { gm, libObj }
}

export async function runAdhoc(ctx: OpCtx, a: Obj) {
  if (!isPlain(a.def))
    throw new Error('action=call 要写 def：{obj, function, args} 调函数、{obj, props} 取值、{obj, prop, value} 改值')
  const g = await readGm(ctx.project)
  const { gm, libObj } = adhocDef(a.def, g.objects)
  const at = new Date().toISOString()
  let res: Awaited<ReturnType<typeof runCustomDef>> | undefined
  let err: Error | undefined
  try {
    res = await runCustomDef(ctx, gm)
  } catch (e) {
    err = e as Error
  }
  if (libObj) await record(ctx, gm, libObj, at, res, err)
  if (err) throw err
  return res
}

/** 记进对象调用的调用记录（和网页同一份本机数据、同样的 key），推事件让开着的 GM 页刷新 */
async function record(ctx: OpCtx, gm: GmCustom, obj: string, at: string, res: Obj | undefined, err: Error | undefined) {
  const out = err
    ? err.message
    : gm.kind === 'get'
      ? String(res?.count ?? '')
      : gm.kind === 'call'
        ? ((res?.invoke as { returned?: unknown }[]) ?? [])
            .map((x) => (typeof x.returned === 'string' ? x.returned : JSON.stringify(x.returned ?? null)))
            .join(', ')
        : ''
  const fn = gm.kind === 'set' ? gm.prop : gm.function
  const v = gm.args[SET_VALUE]
  await pushGmRecent(ctx.project.id, {
    key: `objcall:${obj}`,
    name:
      gm.kind === 'set'
        ? `${gm.prop} = ${isObjArg(v) ? v.$obj : typeof v === 'string' ? v : JSON.stringify(v ?? null)}`
        : gm.kind === 'get'
          ? `读取 ${(gm.props ?? []).join(', ') || '命中的实例'}`
          : `${gm.function}(${Object.values(gm.args)
              .map((x) => (isObjArg(x) ? x.$obj : typeof x === 'string' ? x : JSON.stringify(x)))
              .join(', ')})`,
    args: gm.kind === 'set' && gm.prop ? { [gm.prop]: v } : gm.args,
    code: `Agent：${callText(gm, gm.args)}`,
    ok: !err,
    out: out.slice(0, 500),
    at,
    call: {
      obj,
      mode: gm.kind,
      ...(fn ? { fn } : {}),
      ...(gm.kind === 'get' ? { props: gm.props } : {}),
      many: gm.many,
    },
  })
  c().pages?.push(GM_RECENT_EVENT, { project: ctx.project.id })
}
