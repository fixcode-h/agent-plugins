import type { GtIdentItem, GtRef } from '../types.ts'
import { flushTodo, todo, type MigrateCtx } from './context.ts'

/**
 * v3 的对象定位器（objects 里的 {class, in, key, component, near, client}）→ v4 引用（协议第 9 节）：
 * - key {路径: 值} → ident [{prop: "@self.路径"（写了 @lua. / @item. 的照抄）, op: "eq", value}]
 * - in: "widgets" → "screen"，其余（world、all、@来源.路径）照抄
 * - many：有 near → nearest；没写 key → first（v3 没 key 就取第一个）；否则 error（默认，可省）
 * - component → 另起一个组件引用：原名字指向组件 {class: 组件, in: {obj: 原名字Owner}}，Actor 本身改名为 原名字Owner
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export const keyProp = (path: string) => (path.startsWith('@') ? path : `@self.${path}`)

/** v3 的 `{"$obj": "名字"}` → 名字；其余原样 */
export const unwrapObjRef = (v: unknown): unknown => (isObj(v) && typeof v.$obj === 'string' ? v.$obj : v)

/** 一个定位器 → 引用（不含 component 的拆分） */
export function locatorToRef(loc: Obj): GtRef {
  const { class: cls, in: where, key, component: _c, near, client, ...rest } = loc
  const ident: GtIdentItem[] = isObj(key)
    ? Object.entries(key).map(([p, value]) => ({ prop: keyProp(p), op: 'eq', value }))
    : []
  const ref: GtRef = { ...rest, class: typeof cls === 'string' ? cls : '' }
  if (where !== undefined && where !== null && where !== '')
    ref.in = where === 'widgets' ? 'screen' : (where as GtRef['in'])
  if (ident.length) ref.ident = ident
  const nearV = unwrapObjRef(near)
  if (nearV !== undefined && nearV !== null) ref.near = nearV
  if (client !== undefined && client !== null) ref.client = client as GtRef['client']
  if (nearV !== undefined && nearV !== null) ref.many = 'nearest'
  else if (!ident.length) ref.many = 'first'
  return ref
}

/** 场景顶层 objects 整个迁移（只对 v1–v3 的文件调） */
export function migrateObjects(objects: unknown, ctx: MigrateCtx): Obj | undefined {
  if (!isObj(objects)) return undefined
  const out: Obj = {}
  for (const [name, raw] of Object.entries(objects)) {
    if (!isObj(raw)) {
      out[name] = raw
      continue
    }
    // 只迁 v1–v3 的文件，所以都按定位器读；手写进旧文件的 v4 引用（有 ident、没 key）原样留着
    if ('ident' in raw && !('key' in raw)) {
      out[name] = raw
      continue
    }
    const ref = locatorToRef(raw)
    const comp = raw.component
    if (typeof comp === 'string' && comp) {
      const owner = uniqueName(`${name}Owner`, objects, out)
      out[owner] = ref
      const compRef: GtRef = { class: comp, in: { obj: owner } }
      todo(
        ctx,
        `component「${comp}」按组件类迁移成单独的引用（Actor 本身改名为 ${owner}）；如果原来写的是组件名，改成 {class: 组件类, ident: [{prop: ":class"…}]} 或按名字挑`,
      )
      flushTodo(ctx, compRef as Obj, `objects.${name}`)
      out[name] = compRef
    } else out[name] = ref
  }
  return out
}

function uniqueName(base: string, a: Obj, b: Obj) {
  let n = base
  for (let i = 2; n in a || n in b; i++) n = `${base}${i}`
  return n
}
