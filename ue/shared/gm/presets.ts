import type { GmArgPreset, GmStore } from './schema.ts'

type G = Pick<GmStore, 'argPresets'>

/** 这条 GM 的参数预设 */
export const presetsOf = (g: G, key: string): GmArgPreset[] => g.argPresets[key] ?? []

/** 存一组预设：同名覆盖（位置不变），新的加在最后 */
export function savePreset<T extends G>(g: T, key: string, name: string, args: GmArgPreset['args']): T {
  const n = name.trim()
  const list = presetsOf(g, key)
  const next = list.some((p) => p.name === n)
    ? list.map((p) => (p.name === n ? { name: n, args } : p))
    : [...list, { name: n, args }]
  return { ...g, argPresets: { ...g.argPresets, [key]: next } }
}

/** 删一组；删空了整个键去掉，gm.json 里不留空数组 */
export function dropPreset<T extends G>(g: T, key: string, name: string): T {
  const next = presetsOf(g, key).filter((p) => p.name !== name)
  const argPresets = { ...g.argPresets }
  if (next.length) argPresets[key] = next
  else delete argPresets[key]
  return { ...g, argPresets }
}

/** 改名：新名字已有时不改（返回原样），调用方提示 */
export function renamePreset<T extends G>(g: T, key: string, from: string, to: string): T {
  const n = to.trim()
  const list = presetsOf(g, key)
  if (!n || list.some((p) => p.name === n)) return g
  return { ...g, argPresets: { ...g.argPresets, [key]: list.map((p) => (p.name === from ? { ...p, name: n } : p)) } }
}

/** 条目键改了（自定义 GM 换 id 之类）或条目删了：预设跟着搬或去掉 */
export function movePresets<T extends G>(g: T, from: string, to?: string): T {
  if (!g.argPresets[from]) return g
  const argPresets = { ...g.argPresets }
  if (to) argPresets[to] = argPresets[from]
  delete argPresets[from]
  return { ...g, argPresets }
}
