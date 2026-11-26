import { existsSync } from 'node:fs'
import { ueDocFile } from '../doc-root.ts'
import type { LuaBuildConfig, UeProject } from '../types.ts'
import { readJson, writeJson } from '../util.ts'

/**
 * Lua 编译设置分两处存（用户 2026-11-21）：
 * - 团队共用的（两个按钮各用哪个项目工具、脚本目录）存项目文档根的 AgentPanel/UE/lua-build.json，可以提交，一个人选好全组用；
 * - 个人习惯（编完重载不重载、打开报错用哪个编辑器）留在本机的项目登记里（UeProject.luaBuild）。
 * 读项目时把两份合成一份放在内存的 p.luaBuild 里，存项目登记时只存个人那部分（registry.ts）。
 *
 * 以前这里存两条命令行，从仓库拉来的要本机确认过才跑（2026-11-26 前）。现在按钮只绑项目工具，命令在工具里，
 * 和「技能与 MCP → 工具」里点试运行一样由面板管，这里不再存命令也不再记确认
 */
export const DEFAULT_LUA_BUILD: LuaBuildConfig = {
  fullTool: '',
  incrementalTool: '',
  scriptDir: 'Content/Script',
  autoReload: true,
  editor: '',
}

export const SHARED_KEYS = ['fullTool', 'incrementalTool', 'scriptDir'] as const
type SharedKey = (typeof SHARED_KEYS)[number]
export type SharedLuaBuild = Partial<Pick<LuaBuildConfig, SharedKey>>

/** 旧版存的两条命令行：不再执行，只在编译页提示「做成项目工具」时带上，选好工具保存后从文件里去掉 */
export interface LegacyLuaBuild {
  full?: string
  incremental?: string
}

type P = Pick<UeProject, 'id' | 'root'>

/** 共用文件：read 是读的位置（升级前存在旧文档根的照样读得到），write 是写的位置 */
export const luaBuildFile = (p: P) => ueDocFile(p, 'lua-build.json')

export function sharedPart(x?: Partial<LuaBuildConfig>): SharedLuaBuild {
  const out: SharedLuaBuild = {}
  for (const k of SHARED_KEYS) if (typeof x?.[k] === 'string') out[k] = x[k]
  return out
}

/** 存进本机项目登记的那部分：个人习惯 */
export function localPart(x?: Partial<LuaBuildConfig>): Partial<LuaBuildConfig> | undefined {
  if (!x) return undefined
  const out: Partial<LuaBuildConfig> = {}
  if (typeof x.autoReload === 'boolean') out.autoReload = x.autoReload
  if (typeof x.editor === 'string') out.editor = x.editor
  return Object.keys(out).length ? out : undefined
}

const legacyOf = (x: Record<string, unknown> | undefined): LegacyLuaBuild => {
  const out: LegacyLuaBuild = {}
  for (const k of ['full', 'incremental'] as const) if (typeof x?.[k] === 'string' && x[k]) out[k] = x[k] as string
  return out
}

/** 文档根里还留着的旧命令行（没有时为空） */
export async function legacyLuaBuild(p: P): Promise<LegacyLuaBuild | undefined> {
  const l = legacyOf(await readJson<Record<string, unknown>>(luaBuildFile(p).read, {}))
  return Object.keys(l).length ? l : undefined
}

/**
 * 读项目时调：把文档根里的共用设置合进 p.luaBuild。strip=true 表示本机登记里还留着共用字段（升级前存的），
 * 调用方把登记重写成只剩个人那部分。
 * 一次性搬家：文档根还没有这个文件、本机登记里有旧命令行，就把它们写过去（之后编译页提示做成项目工具时用得上）
 */
export async function mergeLuaBuild(p: UeProject): Promise<{ luaBuild?: Partial<LuaBuildConfig>; strip: boolean }> {
  const file = luaBuildFile(p)
  const raw = (p.luaBuild ?? {}) as Record<string, unknown>
  const strip = Object.keys(raw).some((k) => k !== 'autoReload' && k !== 'editor')
  if (strip && !existsSync(file.read)) {
    const carry = { ...legacyOf(raw), ...sharedPart(p.luaBuild) }
    if (Object.keys(carry).length) await writeJson(file.write, carry)
  }
  const shared = sharedPart(await readJson<SharedLuaBuild>(file.read, {}))
  const merged = { ...localPart(p.luaBuild), ...shared }
  return { luaBuild: Object.keys(merged).length ? merged : undefined, strip }
}

/**
 * 网页上保存：共用部分改了才写文档根（只改了个人习惯不往仓库里写文件）。
 * 两个按钮都选好了工具，旧命令行就没用了，顺手从文件里去掉；还没选全时留着，提示做工具时还要用
 */
export async function saveSharedLuaBuild(p: P, next: SharedLuaBuild, changed: boolean) {
  if (!changed) return
  const keep = next.fullTool && next.incrementalTool ? {} : ((await legacyLuaBuild(p)) ?? {})
  await writeJson(luaBuildFile(p).write, { ...keep, ...sharedPart(next) })
}
