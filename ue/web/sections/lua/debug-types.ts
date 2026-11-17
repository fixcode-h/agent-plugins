import type { LuaDesc } from '../../Lua.tsx'

/** Lua 深度调试（设计稿四.4）网页用到的回包类型，和 UEKit docs/protocol.md 2.4.0「Lua 深度调试」一节对应 */

export interface SnapVar extends LuaDesc {
  name: string
  /** 局部变量是表时它的前几项简单值（快照是事后看的，没法再点进去） */
  fields?: { k: string; v: string | number | boolean }[]
}

export interface SnapCapture {
  at: string
  fn: string
  src: string
  file?: string
  line: number
  locals: SnapVar[]
  upvalues?: SnapVar[]
  stack: string[]
}

export interface Snap {
  id: number
  file: string
  line: number
  hits: number
  max: number
  active: boolean
  created: string
  expiresIn: number
  captures?: SnapCapture[]
}

export type LeakKind = 'destroyed' | 'stale' | 'garbage' | 'noworld'
export interface LeakItem {
  kind: LeakKind
  module?: string
  path?: string
  object?: string
  class?: string
}
export interface LeakResult {
  items: LeakItem[]
  total: number
  visited: number
  truncated: boolean
  ms: number
  report?: string
  note?: string
}

/**
 * 桥接给的文件换成能交给「用编辑器打开」（编译页签的 lua-build/open，和报错跳转同一个入口）的路径：
 * 可能是绝对路径、相对脚本根的路径或模块名（UI.BagPanel），后两种按项目的 Content/Script 拼
 */
export function luaFilePath(file: string) {
  let f = file.replace(/\\/g, '/').replace(/^@/, '')
  if (/^([A-Za-z]:)?\//.test(f)) return f
  if (!f.includes('/') && !f.endsWith('.lua')) f = `${f.replace(/\./g, '/')}.lua`
  return f.startsWith('Content/') ? f : `Content/Script/${f}`
}

/** 打开文件到某一行（网页里由页签传进来；设置里的组件示例传空函数） */
export type OpenAt = (file: string, line?: number) => void

/** 路径只留最后两段（UI/BagPanel.lua），完整的放悬停提示 */
export const shortFile = (f: string) => f.replace(/\\/g, '/').split('/').slice(-2).join('/')
