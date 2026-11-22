import { newCustomId } from './custom.ts'
import { customKey, type GmMacro, type GmStore } from './schema.ts'

/**
 * GM 页左栏右键菜单里对自定义 GM 和宏的改动（重命名、复制一份、删除）：都是 gm.json 上的纯函数，页面拿结果整份存回去。
 * 放 shared 是为了单测能直接跑，不用起页面
 */

/** 「X 副本」「X 副本 2」……：自定义 GM 按名字认（同名保存会覆盖），宏名虽然不要求唯一，重名在列表里也分不清 */
export function copyName(name: string, taken: string[]) {
  const have = new Set(taken)
  for (let i = 1; ; i++) {
    const n = i === 1 ? `${name} 副本` : `${name} 副本 ${i}`
    if (!have.has(n)) return n
  }
}

/** 自定义 GM 改名：名字和别的自定义 GM 重了抛错（保存为 GM、ue_gm save 都按名字认） */
export function renameCustom(g: GmStore, id: string, name: string): GmStore {
  if (g.custom.some((c) => c.id !== id && c.name === name)) throw new Error(`已经有叫「${name}」的自定义 GM 了`)
  return { ...g, custom: g.custom.map((c) => (c.id === id ? { ...c, name } : c)) }
}

/** 复制一份：新 id、名字加「副本」，放在原来那条后面，同一个模块；Agent 标记不带过去（这份是人复制的） */
export function copyCustom(g: GmStore, id: string): { g: GmStore; id: string } | undefined {
  const i = g.custom.findIndex((c) => c.id === id)
  const src = g.custom[i]
  if (!src) return undefined
  const { by: _by, ...rest } = src
  const nid = newCustomId(g.custom.map((c) => c.id))
  const copy = {
    ...structuredClone(rest),
    id: nid,
    name: copyName(
      src.name,
      g.custom.map((c) => c.name),
    ),
  }
  const custom = [...g.custom.slice(0, i + 1), copy, ...g.custom.slice(i + 1)]
  return { g: { ...g, custom }, id: nid }
}

/** 哪些宏用到了这条自定义 GM（删除前的确认里写出来） */
export const macrosUsing = (g: GmStore, id: string): GmMacro[] =>
  g.macros.filter((m) => m.steps.some((s) => s.custom === id))

/** 删自定义 GM：连同它的收藏、宏里调它的步骤（留着只会在执行到那一步时报「已经不在了」）一起去掉 */
export function deleteCustom(g: GmStore, id: string): GmStore {
  const key = customKey(id)
  const moduleOf = Object.fromEntries(Object.entries(g.moduleOf).filter(([k]) => k !== key))
  return {
    ...g,
    custom: g.custom.filter((c) => c.id !== id),
    moduleOf,
    common: g.common.filter((f) => f.key !== key),
    macros: g.macros.map((m) =>
      m.steps.some((s) => s.custom === id) ? { ...m, steps: m.steps.filter((s) => s.custom !== id) } : m,
    ),
  }
}

/** 宏复制一份：放在原来那个后面 */
export function copyMacro(g: GmStore, id: string): { g: GmStore; id: string } | undefined {
  const i = g.macros.findIndex((m) => m.id === id)
  const src = g.macros[i]
  if (!src) return undefined
  let nid = `m${Date.now().toString(36)}`
  while (g.macros.some((m) => m.id === nid)) nid += 'x'
  const copy: GmMacro = {
    id: nid,
    name: copyName(
      src.name,
      g.macros.map((m) => m.name),
    ),
    steps: structuredClone(src.steps),
  }
  return { g: { ...g, macros: [...g.macros.slice(0, i + 1), copy, ...g.macros.slice(i + 1)] }, id: nid }
}

/** 删宏：连同它的收藏 */
export function deleteMacro(g: GmStore, id: string): GmStore {
  return {
    ...g,
    macros: g.macros.filter((x) => x.id !== id),
    common: g.common.filter((f) => f.key !== `macro:${id}`),
  }
}
