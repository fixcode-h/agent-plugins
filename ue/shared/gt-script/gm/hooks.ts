import type { GtStep } from '../types.ts'
import type { GmRef } from './expand.ts'

/**
 * 附带 GM（步骤的 hooks，GameTest 2.3.0，测试页梳理 G10 / G12）：执行前 / 成功后 / 失败时 三组，每组按顺序跑。
 * 每项是一个 gm.run 步骤，另带 onError（note 默认：出错只记一笔；fail：这一步算失败）和 once（循环里只第一次）。
 * 这里只管数据：增删、排序、挪组、开关，界面（检查器的「附带 GM」页、节点右键、节点卡片底下的几行）都调这几个
 */

export type HookGroup = 'before' | 'after' | 'fail'
export const HOOK_GROUPS: HookGroup[] = ['before', 'after', 'fail']

export interface HookItem extends GtStep {
  action: 'gm.run'
  gm: GmRef
  onError?: 'note' | 'fail'
  once?: boolean
  /** 关掉的项（面板自己的开关：存成 disabled，GameTest 照常跳过） */
  disabled?: boolean
}

export type Hooks = Partial<Record<HookGroup, HookItem[]>>

export const hooksOf = (s: GtStep): Hooks =>
  s.hooks && typeof s.hooks === 'object' && !Array.isArray(s.hooks) ? (s.hooks as Hooks) : {}

export const hookList = (s: GtStep, g: HookGroup): HookItem[] => {
  const v = hooksOf(s)[g]
  return Array.isArray(v) ? v : []
}

export const hookCount = (s: GtStep) => HOOK_GROUPS.reduce((n, g) => n + hookList(s, g).length, 0)

/** 换掉一组（空组去掉，三组都空时整个 hooks 去掉，不留空对象） */
export function withGroup(s: GtStep, g: HookGroup, items: HookItem[]): GtStep {
  const hooks: Hooks = { ...hooksOf(s), [g]: items }
  if (!items.length) delete hooks[g]
  const { hooks: _old, ...rest } = s
  return Object.keys(hooks).length ? { ...rest, hooks } : (rest as GtStep)
}

export const makeHook = (gm: GmRef): HookItem => ({ action: 'gm.run', gm })

export const addHook = (s: GtStep, g: HookGroup, item: HookItem) => withGroup(s, g, [...hookList(s, g), item])

export const removeHook = (s: GtStep, g: HookGroup, i: number) =>
  withGroup(
    s,
    g,
    hookList(s, g).filter((_, j) => j !== i),
  )

export function setHook(s: GtStep, g: HookGroup, i: number, item: HookItem): GtStep {
  const list = [...hookList(s, g)]
  if (!list[i]) return s
  list[i] = item
  return withGroup(s, g, list)
}

/** 组内挪位置（拖动、Alt+↑↓）：to 超出范围时夹到两头 */
export function moveHook(s: GtStep, g: HookGroup, from: number, to: number): GtStep {
  const list = [...hookList(s, g)]
  if (!list[from]) return s
  const [it] = list.splice(from, 1)
  list.splice(Math.max(0, Math.min(to, list.length)), 0, it)
  return withGroup(s, g, list)
}

/** 挪到另一组的末尾 */
export function moveHookTo(s: GtStep, g: HookGroup, i: number, to: HookGroup): GtStep {
  const it = hookList(s, g)[i]
  if (!it || g === to) return s
  return addHook(removeHook(s, g, i), to, it)
}

/** 「粘贴别的节点的 GM」：把另一步的三组接在这一步各组后面 */
export function pasteHooks(s: GtStep, from: GtStep): GtStep {
  let out = s
  for (const g of HOOK_GROUPS) for (const it of hookList(from, g)) out = addHook(out, g, structuredClone(it))
  return out
}
