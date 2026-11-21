import type { GmModule, GmStore } from './schema.ts'

/**
 * GM 归哪个模块（规格第 6 节）：手动移过的看 moduleOf；没移过的取分组第一段当模块（不在 modules 里的名字自动算一个模块，
 * 名字就是那一段，用户第一次改它时才写进 modules），剩下的段当子文件夹；没分组的不归任何模块（界面上进「未归模块」）。
 * 自定义 GM 自己带 module。网页的模块树和 ue_gm list 都按这里算
 */

/** 分组按「 / 」拆层级（和 web/sections/gm/data.ts 的 groupPath 一致） */
export const groupSegs = (g: string) =>
  g
    .split(/\s*[/\\]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)

export interface Placement {
  /** 模块 id；undefined = 未归模块 */
  module?: string
  /** 模块下的子文件夹（分组剩下的段；手动移过的不带） */
  folders: string[]
}

/** 名字或 id 对得上的模块 */
export const findModule = (mods: GmModule[], idOrName: string) =>
  mods.find((m) => m.id === idOrName) ?? mods.find((m) => m.name === idOrName)

export function placeOf(key: string, group: string, g: Pick<GmStore, 'moduleOf' | 'modules'>): Placement {
  const moved = g.moduleOf[key]
  if (moved) return { module: findModule(g.modules, moved)?.id ?? moved, folders: [] }
  const [first, ...rest] = groupSegs(group)
  if (!first) return { folders: [] }
  return { module: findModule(g.modules, first)?.id ?? first, folders: rest }
}

/**
 * 全部模块：modules 里存的在前（用户排的顺序），自动的（分组第一段、moduleOf 指向的还没存的）按名字排在后面。
 * auto=true 的还没写进文件
 */
export function allModules(g: Pick<GmStore, 'modules' | 'moduleOf' | 'custom'>, placed: (string | undefined)[]) {
  const out: (GmModule & { auto?: boolean })[] = [...g.modules]
  const auto = new Set<string>()
  for (const id of [...placed, ...g.custom.map((c) => c.module)]) if (id && !findModule(g.modules, id)) auto.add(id)
  for (const id of [...auto].sort((a, b) => a.localeCompare(b))) out.push({ id, name: id, auto: true })
  return out
}

/** 自动的模块要改名、排序前先写进 modules（id 保持那一段名字，已有的 GM 照样按分组对得上） */
export function materialize(g: GmStore, mods: (GmModule & { auto?: boolean })[]): GmStore {
  return { ...g, modules: mods.map(({ id, name }) => ({ id, name })) }
}

/** 新模块 id：短、不和已有的重复 */
export function newModuleId(mods: GmModule[]) {
  for (;;) {
    const id = `m${Math.random().toString(36).slice(2, 6)}`
    if (!mods.some((m) => m.id === id)) return id
  }
}
