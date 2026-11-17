import { stat } from 'node:fs/promises'
import path from 'node:path'
import { cmpVersion } from '../semver.ts'
import type { UeProject } from '../types.ts'

/**
 * trace 里一起录 Lua（Lua 性能分析 Insights 化设计稿 5.1、9.1）：UELink 2.9.0 起有两个 Trace 通道，
 * lua 是 Lua 函数，luac 是 C 函数（UnLua 导出的 UE 接口、Lua 库函数）单独成块，只在 lua 也开着时生效。
 * Lua 是和预设叠加的开关，不另加「含 Lua」预设；网页和 Agent 不给时跟项目设置走，没设置过时装了 UnLua 就开。
 */
export const LUA_TRACE_BRIDGE = '2.9.0'

/** true = lua,luac；'noc' = 只要 lua（C 函数的时间算进调用它的 Lua 函数）；false = 不录 Lua */
export type LuaTrace = boolean | 'noc'

/**
 * 项目里有没有 UnLua（Plugins/ 下任一层有 UnLua.uplugin）：UE 没开时 Lua 页也要列出来，
 * GM 扫描、编译这些只读本机文件的页签不需要 UE 在运行（设计稿四.2、四.3）。.uproject 里关掉的不细判，进页后各页签自己报
 */
export async function hasUnLua(root: string) {
  for (const f of ['Plugins/UnLua/UnLua.uplugin', 'Plugins/UnLua/Plugins/UnLua/UnLua.uplugin']) {
    if (await stat(path.join(root, f)).catch(() => undefined)) return true
  }
  return false
}

/** 参数写法宽松：true / "true" / false / "false" / "noc"；没给或认不出返回 undefined（按项目设置） */
export function parseLuaTrace(v: unknown): LuaTrace | undefined {
  if (v === true || v === 'true') return true
  if (v === false || v === 'false') return false
  if (v === 'noc') return 'noc'
  return undefined
}

/** 项目设置（UeProject.perfLua，用户在录制控件上改过才有）；没改过时装了 UnLua 就录、C 函数单独成块 */
export async function luaTraceDefault(p: UeProject): Promise<LuaTrace> {
  const s = p.perfLua
  const on = s?.on ?? (await hasUnLua(p.root))
  if (!on) return false
  return s?.c === false ? 'noc' : true
}

/**
 * 通道串追加 Lua 的通道并去重（大小写不敏感，保留先出现的写法）。
 * 只要最后含 lua（开关打开或自定义里勾了）就补上 counters：Lua 的每帧计数器（Lua/FrameMs 等）走引擎的计数器宏，
 * counters 通道没开时一个都不写
 */
export function withLuaChannels(channels: string, lua: LuaTrace) {
  const extra = lua === true ? ['lua', 'luac'] : lua === 'noc' ? ['lua'] : []
  const out: string[] = []
  const add = (c: string) => {
    const k = c.trim()
    if (k && !out.some((x) => x.toLowerCase() === k.toLowerCase())) out.push(k)
  }
  for (const c of [...channels.split(','), ...extra]) add(c)
  if (out.some((x) => x.toLowerCase() === 'lua')) add('counters')
  return out.join(',')
}

/** 去掉 Lua 的通道：桥接太旧、项目没装 UnLua 时照常只录 UE 部分 */
export const withoutLuaChannels = (channels: string) =>
  channels
    .split(',')
    .filter((c) => !/^luac?$/i.test(c.trim()))
    .join(',')

export const hasLuaChannel = (channels: string) => channels.split(',').some((c) => c.trim().toLowerCase() === 'lua')

/** 桥接版本够不够录 Lua；读不到版本（名片里没写）时不拦，让引擎自己忽略不认识的通道 */
export const bridgeHasLuaTrace = (bridge?: string) => !bridge || cmpVersion(bridge, LUA_TRACE_BRIDGE) >= 0
