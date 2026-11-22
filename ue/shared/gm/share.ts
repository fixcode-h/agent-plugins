import { z } from 'zod'
import { newCustomId } from './custom.ts'
import { newModuleId } from './modules.ts'
import { GmCustom, GmMacro, GmModule, GmObject, type GmStore } from './schema.ts'

/**
 * GM 的复制 / 导入（GM 页梳理 F8）：右键宏、对象、自定义 GM、模块「复制为 JSON」，别人「从剪贴板导入」合进自己的 gm.json。
 * 包里带上依赖：宏带它调的自定义 GM，自定义 GM 带所在模块，模块带里面的自定义 GM。导入时：
 * 模块按名字认（有同名的就用它）；自定义 GM 的 id 撞了换新的、宏里的引用跟着换；同名的东西加「（导入）」另存，不盖掉已有的
 */
export const GmShare = z.object({
  agentPanelGm: z.literal(1),
  modules: z.array(GmModule).default([]),
  custom: z.array(GmCustom).default([]),
  objects: z.array(GmObject).default([]),
  macros: z.array(GmMacro).default([]),
})
export type GmShare = z.infer<typeof GmShare>

type Mod = { id: string; name: string }
const pack = (p: Partial<Omit<GmShare, 'agentPanelGm'>>): string =>
  JSON.stringify({ agentPanelGm: 1, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v?.length)) }, null, 2)

/** 自定义 GM 所在的模块（modules 里存的，或调用方给的自动算的模块名） */
const modsFor = (g: GmStore, list: GmCustom[], extra: Mod[] = []) => {
  const all = [...g.modules, ...extra]
  const ids = [...new Set(list.map((c) => c.module))]
  return ids.flatMap((id) => all.filter((m) => m.id === id).slice(0, 1))
}

export function shareCustom(g: GmStore, id: string, extra?: Mod[]) {
  const c = g.custom.filter((x) => x.id === id)
  return c.length ? pack({ custom: c, modules: modsFor(g, c, extra) }) : undefined
}

export function shareMacro(g: GmStore, id: string, extra?: Mod[]) {
  const m = g.macros.find((x) => x.id === id)
  if (!m) return undefined
  const used = new Set(m.steps.map((s) => s.custom).filter(Boolean))
  const custom = g.custom.filter((c) => used.has(c.id))
  return pack({ macros: [m], custom, modules: modsFor(g, custom, extra) })
}

export const shareObject = (o: GmObject) => pack({ objects: [o] })

/** 模块：带里面的自定义 GM（扫描出来的 GM 在别人项目里不一定有，只带模块名） */
export function shareModule(g: GmStore, m: Mod) {
  return pack({ modules: [{ id: m.id, name: m.name }], custom: g.custom.filter((c) => c.module === m.id) })
}

/** 同名时另起一个名字：「名字（导入）」「名字（导入 2）」…… */
const freeName = (name: string, taken: Set<string>) => {
  if (!taken.has(name)) return name
  for (let i = 1; ; i++) {
    const n = i === 1 ? `${name}（导入）` : `${name}（导入 ${i}）`
    if (!taken.has(n)) return n
  }
}

export interface ImportResult {
  g: GmStore
  /** 加进来的（类型 + 名字），给提示用 */
  added: string[]
  /** 撞名另存的：原名 → 新名 */
  renamed: [string, string][]
  /** 一模一样已经有了、没再加的 */
  same: string[]
}

/** 把剪贴板里的文字合进 gm.json；不是 GM 的 JSON 抛错（中文说明，原样给用户） */
export function importShare(g: GmStore, text: string): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('剪贴板里不是 JSON：先在 GM 页右键宏、对象、自定义 GM 或模块「复制为 JSON」')
  }
  const r = GmShare.safeParse(raw)
  if (!r.success) throw new Error('剪贴板里的 JSON 不是 GM 页复制出来的（缺 agentPanelGm 或字段不对）')
  const s = r.data
  const out: ImportResult = { g: { ...g }, added: [], renamed: [], same: [] }
  const next = out.g
  // 模块：同名的用已有的，没有就加（id 撞了换新的）
  const modId = new Map<string, string>()
  next.modules = [...g.modules]
  for (const m of s.modules) {
    const have = next.modules.find((x) => x.name === m.name)
    if (have) modId.set(m.id, have.id)
    else {
      const id = next.modules.some((x) => x.id === m.id) ? newModuleId(next.modules) : m.id
      next.modules.push({ id, name: m.name })
      modId.set(m.id, id)
      out.added.push(`模块「${m.name}」`)
    }
  }
  // 自定义 GM：完全一样的跳过；id 撞了换新的；同模块同名改名
  const customId = new Map<string, string>()
  next.custom = [...g.custom]
  for (const c0 of s.custom) {
    const c = { ...c0, module: modId.get(c0.module) ?? c0.module }
    const twin = next.custom.find((x) => JSON.stringify({ ...x, id: '' }) === JSON.stringify({ ...c, id: '' }))
    if (twin) {
      customId.set(c0.id, twin.id)
      out.same.push(`自定义 GM「${c.name}」`)
      continue
    }
    const id = next.custom.some((x) => x.id === c.id) ? newCustomId(next.custom.map((x) => x.id)) : c.id
    const name = freeName(c.name, new Set(next.custom.filter((x) => x.module === c.module).map((x) => x.name)))
    if (name !== c.name) out.renamed.push([c.name, name])
    else out.added.push(`自定义 GM「${c.name}」`)
    next.custom.push({ ...c, id, name })
    customId.set(c0.id, id)
  }
  // 对象：同名同规则跳过，同名不同规则改名
  next.objects = [...g.objects]
  for (const o of s.objects) {
    const have = next.objects.find((x) => x.name === o.name)
    if (have && JSON.stringify({ ...have, folder: '', by: '' }) === JSON.stringify({ ...o, folder: '', by: '' })) {
      out.same.push(`对象「${o.name}」`)
      continue
    }
    const name = freeName(o.name, new Set(next.objects.map((x) => x.name)))
    if (name !== o.name) out.renamed.push([o.name, name])
    else out.added.push(`对象「${o.name}」`)
    next.objects.push({ ...o, name })
  }
  // 宏：步骤里的自定义 GM 换成导入后的 id；同名改名
  next.macros = [...g.macros]
  for (const m of s.macros) {
    const steps = m.steps.map((st) => (st.custom ? { ...st, custom: customId.get(st.custom) ?? st.custom } : st))
    const name = freeName(m.name, new Set(next.macros.map((x) => x.name)))
    if (name !== m.name) out.renamed.push([m.name, name])
    else out.added.push(`宏「${m.name}」`)
    const id = next.macros.some((x) => x.id === m.id) ? `m${Date.now().toString(36)}${next.macros.length}` : m.id
    next.macros.push({ ...m, id, name, steps })
  }
  return out
}
