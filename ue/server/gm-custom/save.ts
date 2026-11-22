import { z } from 'zod'
import { gtNames, isObjArg, newCustomId, objValue } from '../../shared/gm/custom.ts'
import { findModule, newModuleId } from '../../shared/gm/modules.ts'
import { AGENT_FOLDER, normFolder } from '../../shared/gm/obj-folders.ts'
import { GmCustom, GmObject, type GmCustomObj, type GmStore } from '../../shared/gm/schema.ts'
import { runOp, type OpCtx } from '../ops.ts'
import { gmFile, readGm, writeGm } from '../store.ts'

/**
 * ue_gm action=save（规格第 9 节）：kind=gm 存一条自定义 GM，kind=object 存进对象列表；写法同 gm.json。
 * 同名就改（自定义 GM 的 id 不变，最近执行、收藏、宏照样认得）、没有就加；gm 的 module 写模块名或 id，不存在就新建。
 * 存前问 GameTest 的 gt.validate（匹配规则的类、部件、函数名），有错不存、原样返回；编辑器没开就跳过并说明。
 * 游戏开着时顺便回每个对象此刻命中几个。Agent 存的标 by:"agent"（GM 页上显示「Agent 加的」）。dryRun 只回要存成什么
 */
type Obj = Record<string, unknown>

const errText = (e: unknown) =>
  e instanceof z.ZodError
    ? e.issues.map((i) => `${i.path.join('.') || 'def'}：${i.message}`).join('；')
    : (e as Error).message

/** 拼一份临时脚本交给 gt.validate：只有一步 obj.call，对象写进 objects（来源字符串直接写在步骤里） */
function scriptFor(c: GmCustom) {
  // 名字换成 GameTest 认的（lua:BP_Game → lua_BP_Game），和执行时 callStep 一样
  const id = gtNames(Object.keys(c.objects))
  const objects: Obj = {}
  for (const [n, o] of Object.entries(c.objects)) if (o.ref) objects[id.get(n)!] = o.ref
  const objOf = (n: string) => (c.objects[n]?.src ? c.objects[n].src : (id.get(n) ?? n))
  const args: Obj = {}
  for (const [k, v] of Object.entries(c.args)) args[k] = isObjArg(v) ? objOf(v.$obj) : v
  const step =
    c.kind === 'get'
      ? { action: 'obj.find', obj: objOf(c.obj) }
      : { action: 'obj.call', obj: objOf(c.obj), function: c.function ?? '', args, ...(c.part ? { part: c.part } : {}) }
  return { schemaVersion: 5, name: `gm:${c.name}`, objects, steps: [step] }
}

/** 校验：编辑器没开、GameTest 太旧都不拦，只说明没查 */
async function validate(ctx: OpCtx, c: GmCustom) {
  try {
    const r = await runOp(ctx, 'gt.validate', { script: scriptFor(c), deep: true }, 60000)
    return { ok: r.ok !== false, errors: (r.errors as unknown[]) ?? [], warnings: (r.warnings as unknown[]) ?? [] }
  } catch (e) {
    return { ok: true, errors: [], warnings: [], note: `没校验（${(e as Error).message}）` }
  }
}

/** 此刻命中几个：游戏没开、来源字符串都不回 */
async function hitCounts(ctx: OpCtx, objects: Record<string, GmCustomObj>) {
  const refs = Object.entries(objects).flatMap(([id, o]) => (o.ref ? [{ id, ref: objValue(o) }] : []))
  if (!refs.length) return undefined
  try {
    const r = await runOp(ctx, 'gt.resolve', { refs }, 10000)
    const out: Record<string, number | string> = {}
    for (const x of (r.refs as { id: string; count?: number; error?: string }[]) ?? [])
      out[x.id] = x.error ?? x.count ?? 0
    return out
  } catch {
    return undefined
  }
}

async function saveCustom(ctx: OpCtx, g: GmStore, def: Obj, dryRun: boolean, agent: boolean) {
  const modName = String(def.module ?? '').trim()
  if (!modName) throw new Error('kind=gm 要写 module（模块名或 id）；没有合适的就写个新名字，会自动新建')
  const mod = findModule(g.modules, modName)
  const modules = mod ? g.modules : [...g.modules, { id: newModuleId(g.modules), name: modName }]
  const moduleId = (mod ?? modules[modules.length - 1]).id
  const old = g.custom.find((x) => x.name === String(def.name ?? '').trim())
  let c: GmCustom
  try {
    c = GmCustom.parse({
      ...def,
      name: String(def.name ?? '').trim(),
      id: old?.id ?? newCustomId(g.custom.map((x) => x.id)),
      module: moduleId,
      ...(agent ? { by: 'agent' } : {}),
    })
  } catch (e) {
    throw new Error(`def 不合 gm.json 的写法：${errText(e)}`)
  }
  if (!c.objects[c.obj]) throw new Error(`obj「${c.obj}」不在 objects 里：objects 写 {名字: {ref} 或 {src}}`)
  if (c.kind === 'call' && !c.function) throw new Error('kind=call 要写 function')
  const check = await validate(ctx, c)
  if (!check.ok)
    return { saved: false, errors: check.errors, warnings: check.warnings, note: '校验没过，没存；按 errors 改了再存' }
  const next: GmStore = {
    ...g,
    modules,
    custom: old ? g.custom.map((x) => (x.id === old.id ? c : x)) : [...g.custom, c],
  }
  const hits = await hitCounts(ctx, c.objects)
  const base = {
    gm: { key: `custom:${c.id}`, name: c.name, module: modules.find((m) => m.id === moduleId)?.name },
    ...(mod ? {} : { newModule: modName }),
    ...(old ? { updated: true } : { added: true }),
    ...(hits ? { hits } : {}),
    ...(check.warnings.length ? { warnings: check.warnings } : {}),
    ...(check.note ? { note: check.note } : {}),
  }
  if (dryRun) return { dryRun: true, ...base, def: c }
  await writeGm(ctx.project, next)
  return { saved: true, ...base }
}

async function saveObject(ctx: OpCtx, g: GmStore, def: Obj, dryRun: boolean, agent: boolean) {
  let o: GmObject
  const name = String(def.name ?? '').trim()
  // 对象都要在文件夹里（用户 2026-11-22）：没写 folder 时改的沿用原来的文件夹，新加的放进「Agent」
  const prev = g.objects.find((x) => x.name === name)
  const folder = normFolder(typeof def.folder === 'string' ? def.folder : '') || prev?.folder || AGENT_FOLDER
  try {
    o = GmObject.parse({ ...def, name, folder, ...(agent ? { by: 'agent' } : {}) })
  } catch (e) {
    throw new Error(`def 不合对象列表的写法（{name, ref} 或 {name, src}，可加 folder）：${errText(e)}`)
  }
  const old = !!prev
  const hits = o.ref ? await hitCounts(ctx, { [o.name]: { ref: o.ref } }) : undefined
  const base = { object: o.name, ...(old ? { updated: true } : { added: true }), ...(hits ? { hits } : {}) }
  if (dryRun) return { dryRun: true, ...base, def: o }
  await writeGm(ctx.project, {
    ...g,
    objects: old ? g.objects.map((x) => (x.name === o.name ? o : x)) : [...g.objects, o],
  })
  return { saved: true, ...base }
}

export async function saveGmDef(ctx: OpCtx, a: Obj) {
  const def = a.def && typeof a.def === 'object' && !Array.isArray(a.def) ? (a.def as Obj) : undefined
  if (!def)
    throw new Error(
      'save 要写 def：kind=gm 写一条自定义 GM（写法同 gm.json 的 custom），kind=object 写 {name, ref} 或 {name, src}',
    )
  const g = await readGm(ctx.project)
  const agent = ctx.actor.kind !== 'user'
  const dryRun = a.dryRun === true
  const r =
    a.kind === 'object'
      ? await saveObject(ctx, g, def, dryRun, agent)
      : a.kind === 'gm'
        ? await saveCustom(ctx, g, def, dryRun, agent)
        : undefined
  if (!r) throw new Error('save 的 kind 写 gm（自定义 GM）或 object（对象列表）')
  return { ...r, file: gmFile(ctx.project) }
}
