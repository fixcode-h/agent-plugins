import type { GtIdentItem, GtRef, GtRefLike, GtTarget } from '../types.ts'
import { todo, type MigrateCtx } from './context.ts'

/**
 * v3 选择器 → v4 的部件写法 {obj, part?, slate?}（协议第 9 节前几行）：
 * - `WBP_X:Root/A/B` → {obj: {class: WBP_X}, part: "B"}（同一个类的树里只留最后一段控件名）；`WBP_X:.` → {obj: {class: WBP_X}}
 * - `A>B` → part "A.B"（A 是嵌套 WBP 的部件名）
 * - `容器[字段=值]>B` → 条目引用 {class: 条目类, in: {obj, part: 容器}, ident: [{prop: "@item.字段" / "@self.字段", op: eq, value}]} + part B
 * - `@句柄` → `$句柄`；`$item>B` → {obj: "$item", part: "B"}；`>>Slate段` → slate
 * - `列表[n]`、`#类名#n`、`text=…`、没写屏名、`>>Slate` 前没有 UMG：尽量从录制线索（hint.key / hint.asset）挑标识，
 *   挑不出写 many: "first" + todo
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** 按分隔符切，方括号和引号里的不切 */
export function splitOutside(s: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      cur += c
      if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '[') depth++
    else if (c === ']') depth = Math.max(0, depth - 1)
    if (!depth && !quote && s.startsWith(sep, i)) {
      out.push(cur)
      cur = ''
      i += sep.length - 1
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

/** 选择器里条件的值：数字、布尔按类型，引号去掉，$var 原样 */
export function literal(v: string): unknown {
  const s = v.trim()
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (s === 'true' || s === 'false') return s === 'true'
  const q = /^(["'])(.*)\1$/.exec(s)
  return q ? q[2] : s
}

/** 录制线索里的条目信息（GameTest 1.4 的 hint.key） */
const keyOf = (ctx: MigrateCtx): Obj | undefined => (isObj(ctx.hint?.key) ? (ctx.hint.key as Obj) : undefined)
const listOf = (ctx: MigrateCtx): boolean | undefined => {
  const k = keyOf(ctx)
  return typeof k?.list === 'boolean' ? k.list : undefined
}

/** 条件左边 → 属性路径：写了来源的照抄（@item. @itemLua. @self. @lua.），没写的 ListView 看数据对象、别的容器看条目控件自己 */
function propOf(left: string, list: boolean | undefined, ctx: MigrateCtx): string | undefined {
  const k = left.trim()
  if (/^@(item|itemLua|self|lua)\./i.test(k)) return k
  if (/^@text$/i.test(k)) return ':text'
  if (/^@(row|col)$/i.test(k)) {
    todo(ctx, `格子的行列（${k}）没有对应的属性，换一个能区分条目的属性`)
    return undefined
  }
  if (k.startsWith('@')) {
    todo(ctx, `不认识的条目来源 ${k}`)
    return undefined
  }
  if (list === undefined)
    todo(ctx, `不知道容器是不是 ListView 族，${k} 按条目的数据对象（@item.）迁移；不是列表时改成 @self.${k}`)
  return `${list === false ? '@self.' : '@item.'}${k}`
}

/** 方括号里的条件 `a=1,@self.b=x` → ident */
function identOf(inner: string, list: boolean | undefined, ctx: MigrateCtx): GtIdentItem[] {
  const out: GtIdentItem[] = []
  for (const part of splitOutside(inner, ',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const prop = propOf(part.slice(0, eq), list, ctx)
    if (prop) out.push({ prop, op: 'eq', value: literal(part.slice(eq + 1)) })
  }
  return out
}

/** 录制时挑过的标识（hint.key.cands 里唯一、分数最高的，或 hint.key.cond）；挑不出 undefined */
function identFromHint(ctx: MigrateCtx): GtIdentItem[] | undefined {
  const key = keyOf(ctx)
  if (!key) return undefined
  const list = listOf(ctx)
  const cands = (Array.isArray(key.cands) ? key.cands : []).filter(isObj)
  const best = cands
    .filter((c) => c.unique === true && typeof c.by === 'string' && c.v !== undefined)
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))[0]
  if (best) {
    const by = String(best.by)
    return [{ prop: by.startsWith('@') ? by : `${list === false ? '@self.' : '@item.'}${by}`, op: 'eq', value: best.v }]
  }
  if (typeof key.cond === 'string' && key.cond.includes('=')) {
    const probe: MigrateCtx = { ...ctx, pending: [] }
    const items = identOf(key.cond.replace(/^\[|\]$/g, ''), list, probe)
    if (items.length && !probe.pending.length) return items
  }
  return undefined
}

/** 条目引用：在 obj 的容器部件里 */
function entryRef(
  obj: GtRefLike,
  container: string,
  cls: string | undefined,
  ident: GtIdentItem[] | undefined,
  why: string,
  ctx: MigrateCtx,
): GtRef {
  const key = keyOf(ctx)
  const entry = cls ?? (typeof key?.entry === 'string' && key.entry ? key.entry : undefined)
  if (!entry) todo(ctx, `条目类不知道，先写了 UserWidget：改成 ${container || '容器'} 里条目的类`)
  const picked = ident ?? identFromHint(ctx)
  const ref: GtRef = { class: entry ?? 'UserWidget', in: { obj, ...(container ? { part: container } : {}) } }
  if (picked?.length) ref.ident = picked
  else {
    ref.many = 'first'
    todo(ctx, `${why}：挑不出能区分条目的属性，先按第一个；在属性树里给它挑标识`)
  }
  return ref
}

/** 选择器里没有能当对象的东西时：用录制线索里的 WBP 资源（hint.asset），没有就 UserWidget + first */
function fromHint(why: string, ctx: MigrateCtx): GtRef {
  const asset = typeof ctx.hint?.asset === 'string' ? (ctx.hint.asset as string).split('.')[0] : ''
  todo(ctx, `${why}：${asset ? `按录制时的界面 ${asset} 找，` : ''}先按第一个，确认是哪个对象后补上标识`)
  return { class: asset || 'UserWidget', many: 'first' }
}

/** 屏名 → 类：资源路径原样（类接受路径），`*` 和没写的从录制线索找 */
function screenClass(screen: string, ctx: MigrateCtx): GtRef {
  const s = screen.trim()
  if (s && s !== '*') return { class: s }
  return fromHint('没写屏名的选择器', ctx)
}

interface Cursor {
  obj: GtRefLike
  part: string[]
}

/** 一段 `>` 之间的路径：只看最后一段（前面的是同一个类的树里的父链），容器 / 条目换对象 */
function advance(w: Cursor, path: string, ctx: MigrateCtx) {
  const segs = splitOutside(path, '/')
    .map((x) => x.trim())
    .filter((x) => x && x !== '.')
  if (!segs.length) return
  const last = segs[segs.length - 1]
  const prev = segs[segs.length - 2]
  const container = (name: string) => [...w.part, name].filter(Boolean).join('.')
  let m: RegExpExecArray | null
  if ((m = /^([^[\]]*)\[(.*)\]$/.exec(last))) {
    const [, name, inner] = m
    if (/^\s*\d+\s*$/.test(inner))
      w.obj = entryRef(w.obj, container(name), undefined, undefined, `${name}[${inner.trim()}] 按位置找条目`, ctx)
    else {
      const ident = identOf(inner, listOf(ctx), ctx)
      w.obj = entryRef(
        w.obj,
        container(name),
        undefined,
        ident.length ? ident : undefined,
        `${last} 的条件读不出来`,
        ctx,
      )
    }
    w.part = []
  } else if ((m = /^#([^#]+)(?:#(\d+))?$/.exec(last))) {
    w.obj = entryRef(w.obj, prev ? container(prev) : w.part.join('.'), m[1], undefined, `${last} 按类和序号找`, ctx)
    w.part = []
  } else if (/^text=/i.test(last)) todo(ctx, `${last} 按显示的文字找控件：v4 不按文字定位，改成部件名或条目引用`)
  else if (last === '*' || last === '..') todo(ctx, `路径里的 ${last} 没法迁移：写清楚是哪个部件`)
  else w.part.push(last)
}

/**
 * 迁一个选择器。返回部件写法；选择器是空的、不是字符串时 undefined。
 * 句柄（`@h`）落在部件上时，后面接着写的部件拼在它后面
 */
export function selectorToTarget(sel: unknown, ctx: MigrateCtx): GtTarget | undefined {
  if (typeof sel !== 'string' || !sel.trim()) return undefined
  const [umg, ...slateParts] = splitOutside(sel.trim(), '>>')
  const slate = slateParts.join('>>').trim()
  const pieces = umg.trim() ? splitOutside(umg.trim(), '>') : []
  const w: Cursor = { obj: '', part: [] }
  if (!pieces.length) w.obj = fromHint('>>Slate 前面没有 UMG 控件', ctx)
  else {
    const head = pieces[0].trim()
    const h = /^@([A-Za-z_]\w*)$/.exec(head)
    const v = /^\$([A-Za-z_]\w*)$/.exec(head)
    if (v && ctx.selVars.has(v[1])) {
      // 变量里存的是选择器：换成它的值再迁（后面接着写的 >X 拼在后面）
      const rest = sel.trim().slice(head.length)
      const others = new Map(ctx.selVars)
      others.delete(v[1])
      return selectorToTarget(`${ctx.selVars.get(v[1])}${rest}`, { ...ctx, selVars: others })
    }
    // 变量的成员（$row.target）、参数（call 传进来的选择器）：选择器是数据，v4 没有对应写法
    const dataSel = /^\$([A-Za-z_]\w*)(\.[\w.]+)?$/.exec(head)
    if (dataSel && (dataSel[2] || ctx.selParams.has(dataSel[1]))) {
      todo(
        ctx,
        `${head} 是存在变量 / 参数里的 v3 选择器，v4 不支持把选择器当数据传：改成直接写引用，或传对象引用的名字`,
      )
      return { obj: head }
    }
    if (h) {
      w.obj = `$${h[1]}`
      const p = ctx.handles.get(h[1])
      if (p) w.part = p.split('.')
    } else if (/^\$[A-Za-z_]\w*$/.test(head)) w.obj = head
    else {
      const colon = splitOutside(head, ':')
      w.obj = screenClass(colon.length > 1 ? colon[0] : '', ctx)
      advance(w, colon.length > 1 ? colon.slice(1).join(':') : head, ctx)
    }
    for (const piece of pieces.slice(1)) advance(w, piece, ctx)
  }
  return { obj: w.obj, ...(w.part.length ? { part: w.part.join('.') } : {}), ...(slate ? { slate } : {}) }
}

/** 只要对象（obj.close 的 obj）：选择器落在部件上时记 todo */
export function selectorToRef(sel: unknown, ctx: MigrateCtx, what: string): GtRefLike | undefined {
  const t = selectorToTarget(sel, ctx)
  if (!t) return undefined
  if (t.part || t.slate)
    todo(
      ctx,
      `${what}的是 ${[t.part, t.slate].filter(Boolean).join(' / ')}（对象里的部件），v4 只对整个对象做：确认对不对`,
    )
  return t.obj
}
