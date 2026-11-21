import { ueDocFile } from '../doc-root.ts'
import type { UeProject } from '../types.ts'
import { readJson, writeJson } from '../util.ts'

/**
 * Lua 设置（「权限与设置 → Lua」，用户 2026-11-21：Lua 相关的都放 UE 插件设置里，扩展到整个 UE 插件）。
 * 存项目文档根的 AgentPanel/UE/lua.json（团队共用，一个人配好全组用，和 Lua 编译的共用部分一样）。
 * 各项留空 = 自动。连上某个 UE 进程时由 ensureLuaConfig 下发给 UELink（lua.config，UELink 2.20 起），
 * UELink 再存进 Saved/UELink/lua-config.json，没连面板跑的 GameTest 也用得上。
 */
export interface LuaSettings {
  /** 纯 Lua 实例上写着自己类（模块路径）的字段，如 SubModulePath */
  classFields: string[]
  /** 从哪些变量开始找纯 Lua 实例（_G.GameApp.Modules）；空 = 走整个 Lua 堆 */
  roots: string[]
  /** 纯 Lua 实例的显示名字段，如 SubModuleName */
  nameFields: string[]
  /** UnLua 实例表里放 UObject 的字段名；空 = Object */
  objectKey: string
  /** 走堆最多看多少个表 / 函数；0 = 默认（20 万） */
  maxVisit: number
}

export const DEFAULT_LUA_SETTINGS: LuaSettings = {
  classFields: [],
  roots: [],
  nameFields: [],
  objectKey: '',
  maxVisit: 0,
}

type P = Pick<UeProject, 'id' | 'root'>

export const luaSettingsFile = (p: P) => ueDocFile(p, 'lua.json')

const list = (v: unknown) =>
  [
    ...new Set(
      (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,，]/) : [])
        .map((x) => String(x).trim())
        .filter(Boolean),
    ),
  ].slice(0, 20)

export function normalizeLuaSettings(raw: unknown): LuaSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const max = Math.round(Number(o.maxVisit) || 0)
  return {
    classFields: list(o.classFields),
    roots: list(o.roots),
    nameFields: list(o.nameFields),
    objectKey: typeof o.objectKey === 'string' ? o.objectKey.trim() : '',
    maxVisit: max > 0 ? Math.min(2_000_000, Math.max(1000, max)) : 0,
  }
}

export async function readLuaSettings(p: P): Promise<LuaSettings> {
  return normalizeLuaSettings(await readJson(luaSettingsFile(p).read, DEFAULT_LUA_SETTINGS))
}

export async function saveLuaSettings(p: P, raw: unknown): Promise<LuaSettings> {
  const next = normalizeLuaSettings(raw)
  await writeJson(luaSettingsFile(p).write, next)
  // 已经连着的进程下次调 Lua / GameTest 操作时重新下发
  pushed.clear()
  return next
}

/** 下发给 UELink 的那份：脚本根取 Lua 编译设置里的脚本目录（两处共用一个，不另设） */
export async function uelinkLuaConfig(p: P & Pick<UeProject, 'luaBuild'>) {
  const s = await readLuaSettings(p)
  return {
    scriptRoot: p.luaBuild?.scriptDir && p.luaBuild.scriptDir !== 'Content/Script' ? p.luaBuild.scriptDir : '',
    objectKey: s.objectKey,
    classFields: s.classFields,
    roots: s.roots,
    nameFields: s.nameFields,
    ...(s.maxVisit ? { maxVisit: s.maxVisit } : {}),
  }
}

/** 每个 UE 进程下发过的设置（进程号 → 内容）：内容没变不重发 */
const pushed = new Map<number, string>()

/**
 * Lua、GameTest 操作发出去之前确认这个进程拿到了最新的 Lua 设置。UELink 太旧没有 lua.config 时记下、不再试，
 * 只是那个进程用不上设置（纯 Lua 实例照样按元表链自动找）
 */
export async function ensureLuaConfig(
  p: P & Pick<UeProject, 'luaBuild'>,
  card: { pid: number },
  op: string,
  send: (op: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  if (!/^(lua|gt)\./.test(op) || op === 'lua.config') return
  const cfg = await uelinkLuaConfig(p)
  const text = JSON.stringify(cfg)
  if (pushed.get(card.pid) === text) return
  pushed.set(card.pid, text)
  await send('lua.config', { set: cfg }).catch(() => undefined)
}
