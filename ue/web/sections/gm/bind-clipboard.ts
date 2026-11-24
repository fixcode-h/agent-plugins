import { copyText } from '@panel/web/src/components/ui/item-menu'
import type { LuaGmBinding } from '../../../server/lua-gm/types.ts'

/**
 * 参数关联表格的复制 / 粘贴（用户 2026-11-24：表格按钮右键复制粘贴，把一个参数的关联套到别的参数上）。
 * 复制时同时写系统剪贴板（JSON，换页、刷新后也能粘）和这里的一份；粘贴先用这里的，
 * 没有才读系统剪贴板——读剪贴板浏览器会弹授权，同一页里复制粘贴不该每次都问
 */
const MARK = 'agentPanelGmBinding'
const held: { b?: LuaGmBinding } = {}

const valid = (x: unknown): x is LuaGmBinding =>
  !!x &&
  typeof x === 'object' &&
  typeof (x as LuaGmBinding).table === 'string' &&
  typeof (x as LuaGmBinding).key === 'string'

/** 复制一份关联 */
export function copyBinding(b: LuaGmBinding) {
  held.b = { ...b, extra: b.extra ? [...b.extra] : undefined }
  // 面板菜单的复制：剪贴板接口不可用时有兜底，并提示「已复制」
  copyText(JSON.stringify({ [MARK]: b }))
}

/** 这一页里复制过的关联（菜单上显示「粘贴」的来源用） */
export const heldBinding = () => held.b

/** 取要粘贴的关联：先用这一页复制的，没有再读系统剪贴板；都没有返回 undefined */
export async function pasteBinding(): Promise<LuaGmBinding | undefined> {
  if (held.b) return { ...held.b, extra: held.b.extra ? [...held.b.extra] : undefined }
  try {
    const raw = JSON.parse(await navigator.clipboard.readText()) as Record<string, unknown>
    const b = raw?.[MARK]
    return valid(b) ? b : undefined
  } catch {
    // 剪贴板里不是复制的关联、或浏览器不让读：当作没有
    return undefined
  }
}

/** 两份关联是否一样（粘贴同一份时菜单项灰掉） */
export const sameBinding = (a?: LuaGmBinding, b?: LuaGmBinding) =>
  !!a && !!b && JSON.stringify({ ...a, extra: a.extra ?? [] }) === JSON.stringify({ ...b, extra: b.extra ?? [] })
