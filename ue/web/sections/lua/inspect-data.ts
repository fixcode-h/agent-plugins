import { formatLuaPath, type LuaKey } from '../../../server/luapath.ts'
import type { LuaDesc, LuaField } from '../../Lua.tsx'

/** UELink 2.4 lua.inspect 的回包（UEKit docs/protocol.md） */
export interface LuaFn {
  name: string
  params: string[]
  vararg: boolean
  src?: string
  /** 0 = 自己的，n = 元表链上第 n 层继承来的 */
  from: number
}
export interface InspectRes {
  value: LuaDesc
  /** path、reflected 是 UELink 2.19.1 起才有的 */
  chain?: { name: string; src?: string; path?: string; reflected?: boolean }[]
  src?: string
  fields?: LuaField[]
  functions?: LuaFn[]
  upvalues?: { fn: string; name: string; t: string; v?: unknown; int?: boolean }[]
  total?: number
  more?: boolean
  note?: string
}
export interface CallRes {
  results: LuaDesc[]
  output: string[]
  ms: number
  changes?: { k: string; before: unknown; after: unknown }[]
}

/** 检视的起点：path 是 UObject 路径（绑定对象的实例表），空串是 _G；keys 往下走 */
export interface LuaRoot {
  path: string
  keys: LuaKey[]
  /** 左栏显示的名字（绑定对象用对象名） */
  label?: string
}

export const rootKey = (r: LuaRoot) => `${r.path}\u0001${r.keys.join('\u0001')}`

/** 复制 / 监视里显示的完整路径：绑定对象写成「对象名:字段」，全局的写 Lua 路径 */
export function rootText(r: LuaRoot) {
  const p = formatLuaPath(r.keys)
  if (!r.path) return p || '_G'
  const name = r.label ?? r.path.split(/[.:]/).pop()
  return p ? `${name}:${p}` : (name ?? r.path)
}

/**
 * 参数框、改表字段的文字 → JSON 值：能按 JSON 解析就按 JSON（对象 / 数组会转成 Lua 表），
 * 否则 nil、true / false、数字按字面，其余当字符串（不用给字符串加引号）
 */
export function parseArg(raw: string): unknown {
  const s = raw.trim()
  if (s === '' || s === 'nil') return null
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/** 函数的签名：AddGold(self, n, ...) */
export function signature(fn: LuaFn) {
  return `${fn.name}(${[...fn.params, ...(fn.vararg ? ['...'] : [])].join(', ')})`
}
