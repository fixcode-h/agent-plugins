import { allModules, materialize, newModuleId } from '../../../../shared/gm/modules.ts'
import type { GmModule, GmStore } from '../../../../shared/gm/schema.ts'

/**
 * 模块树上的改动（规格第 6 节）：都是 gm.json 上的纯函数，GmPage 拿结果整份存回去。
 * 自动的模块（分组第一段、还没写进 modules 的）第一次改名、排序时先把全部模块按现在的顺序写进去，顺序才稳定
 */
export type Mods = (GmModule & { auto?: boolean })[]

export function addModule(g: GmStore, name: string): { g: GmStore; id: string } {
  const id = newModuleId(g.modules)
  return { g: { ...g, modules: [...g.modules, { id, name }] }, id }
}

export function renameModule(g: GmStore, mods: Mods, id: string, name: string): GmStore {
  const base = mods.some((m) => m.auto) ? materialize(g, mods) : g
  return { ...base, modules: base.modules.map((m) => (m.id === id ? { ...m, name } : m)) }
}

/** 只能删空的：调用方先判断（count === 0），这里不再查 */
export function deleteModule(g: GmStore, id: string): GmStore {
  const moduleOf = Object.fromEntries(Object.entries(g.moduleOf).filter(([, v]) => v !== id))
  return { ...g, modules: g.modules.filter((m) => m.id !== id), moduleOf }
}

export function shiftModule(g: GmStore, mods: Mods, id: string, d: -1 | 1): GmStore {
  const base = materialize(g, mods)
  const list = [...base.modules]
  const i = list.findIndex((m) => m.id === id)
  const j = i + d
  if (i < 0 || j < 0 || j >= list.length) return g
  ;[list[i], list[j]] = [list[j], list[i]]
  return { ...base, modules: list }
}

/** GM 移到模块：扫描出来的记 moduleOf，自定义 GM 改它自己的 module */
export function moveToModule(g: GmStore, key: string, moduleId: string): GmStore {
  if (key.startsWith('custom:')) {
    const id = key.slice(7)
    return { ...g, custom: g.custom.map((c) => (c.id === id ? { ...c, module: moduleId } : c)) }
  }
  return { ...g, moduleOf: { ...g.moduleOf, [key]: moduleId } }
}

export { allModules }
