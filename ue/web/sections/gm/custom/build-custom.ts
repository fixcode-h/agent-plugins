import { newCustomId, objNamesInArgs } from '../../../../shared/gm/custom.ts'
import { newModuleId } from '../../../../shared/gm/modules.ts'
import type { GmCustom, GmCustomObj, GmMany, GmObject, GmStore } from '../../../../shared/gm/schema.ts'
import type { SaveGmResult } from './SaveGmDialog.tsx'

/** 对象列表里的一项 → 自定义 GM 里的对象副本 */
const copyObj = (o: GmObject): GmCustomObj => (o.src ? { src: o.src } : { ref: { ...o.ref! } })

/**
 * 对象调用「保存为 GM」→ gm.json（规格第 7 节）：把用到的对象（调用的对象 + 对象参数）的匹配规则复制进 custom.objects，
 * 之后改对象列表不影响这条 GM；同名的就改它（id 不变）。新建的模块一起写进 modules
 */
export function addCustom(
  g: GmStore,
  src: {
    objects: GmObject[]
    obj: string
    kind: 'call' | 'get'
    function?: string
    part?: string | null
    args: Record<string, unknown>
    many: GmMany
    props?: string[]
  },
  r: SaveGmResult,
): { g: GmStore; id: string } {
  let modules = g.modules
  let module = r.module
  if (r.newModule) {
    module = newModuleId(modules)
    modules = [...modules, { id: module, name: r.newModule }]
  }
  const names = [src.obj, ...objNamesInArgs(src.args)]
  const objects: Record<string, GmCustomObj> = {}
  for (const n of names) {
    const o = src.objects.find((x) => x.name === n)
    if (!o) throw new Error(`对象「${n}」不在对象列表里`)
    objects[n] = copyObj(o)
  }
  const old = g.custom.find((c) => c.name === r.name)
  const id = old?.id ?? newCustomId(g.custom.map((c) => c.id))
  const c: GmCustom = {
    id,
    name: r.name,
    module,
    ...(r.note ? { note: r.note } : {}),
    kind: src.kind,
    obj: src.obj,
    objects,
    ...(src.kind === 'call' ? { function: src.function, ...(src.part ? { part: src.part } : {}) } : {}),
    args: src.kind === 'call' ? src.args : {},
    editable: src.kind === 'call' ? r.editable : [],
    many: src.many,
    ...(src.kind === 'get' ? { props: src.props ?? [] } : {}),
  }
  return { g: { ...g, modules, custom: old ? g.custom.map((x) => (x.id === id ? c : x)) : [...g.custom, c] }, id }
}
