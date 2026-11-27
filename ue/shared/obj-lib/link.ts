import type { GmObject } from '../gm/schema.ts'
import type { GtScript } from '../gt-script/types.ts'

/**
 * 脚本引用对象库（测试页梳理第三期 3.3，用户 2026-11-22 定「拷规则 + 记来源」）：
 * 用到对象库里的对象时，把匹配规则拷进脚本的 objects（GameTest 只认脚本自己的 objects，跑的时候不读对象库），
 * 再在脚本顶层 `objLib` 记下「脚本里的名字 → 对象库里的路径（文件夹/名字）」。GameTest 不读 objLib（顶层不认识的字段不报错），
 * 只是面板打开脚本时拿它和对象库比，库里改了就提示「同步 / 保留脚本里的」。
 * 不把来源写进引用本身：引用里多一个字段 GameTest 会报 unknown_field
 */

/** 对象库里一项的路径：文件夹/名字（最外层的只有名字） */
export const libPath = (o: Pick<GmObject, 'name' | 'folder'>) => (o.folder ? `${o.folder}/${o.name}` : o.name)

/** 对象库的一项在脚本 objects 里的写法：匹配规则原样，来源对象写来源字符串 */
export const objValue = (o: Pick<GmObject, 'ref' | 'src'>): unknown => o.ref ?? o.src

/** 拖进画布的步骤上带的对象库信息（面板自己的字段，进脚本前就收掉，不会存盘） */
export const LIB_DROP_KEY = '$lib'
export interface LibDrop {
  /** 步骤里用的名字（obj 写的就是它） */
  name: string
  path: string
  value: unknown
}

const objLibOf = (doc: GtScript) =>
  doc.objLib && typeof doc.objLib === 'object' ? (doc.objLib as Record<string, string>) : {}

/** 脚本里给这个库对象用的名字：已经链着同一项的复用；名字被别的占了就加数字 */
function nameFor(doc: GtScript, want: string, path: string): string {
  const objects = (doc.objects ?? {}) as Record<string, unknown>
  const links = objLibOf(doc)
  const same = Object.keys(links).find((n) => links[n] === path && n in objects)
  if (same) return same
  let name = want
  for (let i = 2; name in objects; i++) name = `${want}${i}`
  return name
}

/** 把对象库的一项拷进脚本（已经有同一项的链接就只返回它的名字，不覆盖脚本里的规则） */
export function linkObject(doc: GtScript, o: GmObject): { doc: GtScript; name: string } {
  const path = libPath(o)
  const name = nameFor(doc, o.name, path)
  const objects = (doc.objects ?? {}) as Record<string, unknown>
  if (name in objects && objLibOf(doc)[name] === path) return { doc, name }
  return {
    doc: { ...doc, objects: { ...objects, [name]: objValue(o) }, objLib: { ...objLibOf(doc), [name]: path } },
    name,
  }
}

/**
 * 收掉拖进来的步骤上的 `$lib`：对象拷进 objects、记进 objLib，步骤的 obj 换成脚本里实际用的名字；
 * 值本身是 `{"$lib": …}`（对象块里选了对象库的一项）时整个换成名字。
 * 每次改脚本都过一遍（拖放有三个落点：空白处、连线上的 +、空槽，都走同一个 apply）；没有 `$lib` 时原样返回同一个对象
 */
export function absorbLibDrops(doc: GtScript): GtScript {
  let out = doc
  let changed = false
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      let diff = false
      const arr = v.map((x) => {
        const y = visit(x)
        if (y !== x) diff = true
        return y
      })
      return diff ? arr : v
    }
    if (!v || typeof v !== 'object') return v
    const o = v as Record<string, unknown>
    let next: Record<string, unknown> | undefined
    for (const [k, x] of Object.entries(o)) {
      if (k === LIB_DROP_KEY) continue
      const y = visit(x)
      if (y !== x) (next ??= { ...o })[k] = y
    }
    const drop = o[LIB_DROP_KEY] as LibDrop | undefined
    if (drop && typeof drop === 'object' && typeof drop.name === 'string') {
      next ??= { ...o }
      delete next[LIB_DROP_KEY]
      const folder = drop.path.includes('/') ? drop.path.slice(0, drop.path.lastIndexOf('/')) : undefined
      const r = linkObject(out, {
        name: drop.name,
        ...(folder ? { folder } : {}),
        ...(typeof drop.value === 'string' ? { src: drop.value } : { ref: drop.value as GmObject['ref'] }),
      })
      out = r.doc
      changed = true
      // 只有 `$lib` 的对象（对象块里选了对象库的一项，填在 obj 或对象参数的位置）：整个换成脚本里的名字
      if (Object.keys(o).length === 1) return r.name
      if (next.obj === drop.name) next.obj = r.name
    }
    if (next) changed = true
    return next ?? v
  }
  const steps = visit({ setup: doc.setup, steps: doc.steps, teardown: doc.teardown, guards: doc.guards }) as Pick<
    GtScript,
    'setup' | 'steps' | 'teardown' | 'guards'
  >
  if (!changed) return doc
  return { ...out, ...strip(steps) }
}

const strip = (s: Pick<GtScript, 'setup' | 'steps' | 'teardown' | 'guards'>) => {
  const o: Partial<GtScript> = {}
  if (s.setup !== undefined) o.setup = s.setup
  if (s.steps !== undefined) o.steps = s.steps
  if (s.teardown !== undefined) o.teardown = s.teardown
  if (s.guards !== undefined) o.guards = s.guards
  return o
}

/** 脚本里链着对象库、但和库里现在的不一样的对象（库里删掉了的 gone） */
export interface LibDrift {
  name: string
  path: string
  gone?: boolean
}

export function libDrift(doc: GtScript, lib: GmObject[]): LibDrift[] {
  const objects = (doc.objects ?? {}) as Record<string, unknown>
  const out: LibDrift[] = []
  for (const [name, path] of Object.entries(objLibOf(doc))) {
    if (!(name in objects)) continue
    const o = lib.find((x) => libPath(x) === path)
    if (!o) out.push({ name, path, gone: true })
    else if (JSON.stringify(objValue(o)) !== JSON.stringify(objects[name])) out.push({ name, path })
  }
  return out
}

/** 按对象库更新脚本里这几个对象（库里删掉了的断开链接、保留脚本里的规则） */
export function syncFromLib(doc: GtScript, lib: GmObject[], names: string[]): GtScript {
  const objects = { ...((doc.objects ?? {}) as Record<string, unknown>) }
  const links = { ...objLibOf(doc) }
  for (const n of names) {
    const o = lib.find((x) => libPath(x) === links[n])
    if (o) objects[n] = objValue(o)
    else delete links[n]
  }
  return { ...doc, objects, objLib: links }
}

/** 不再跟着对象库（「保留脚本里的」）：断开这几个对象的链接 */
export function unlinkLib(doc: GtScript, names: string[]): GtScript {
  const links = { ...objLibOf(doc) }
  for (const n of names) delete links[n]
  const { objLib: _old, ...rest } = doc
  return Object.keys(links).length ? { ...rest, objLib: links } : rest
}
