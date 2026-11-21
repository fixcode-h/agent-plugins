import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { ueDocFile } from '../doc-root.ts'
import type { LuaBuildConfig, UeProject } from '../types.ts'
import { c, readJson, writeJson } from '../util.ts'

/**
 * Lua 编译设置分两处存（用户 2026-11-21）：
 * - 团队共用的（两条编译指令、工作目录、脚本目录、报错格式）存项目文档根的 AgentPanel/UE/lua-build.json，可以提交，一个人配好全组用；
 * - 个人习惯（编完重载不重载、打开报错用哪个编辑器）留在本机的项目登记里（UeProject.luaBuild）。
 * 读项目时把两份合成一份放在内存的 p.luaBuild 里，存项目登记时只存个人那部分（registry.ts）。
 *
 * 编译指令整行交给命令行执行，放进仓库后别人改一下、你拉一次代码就会在你的机器上跑：
 * 所以本机记一份「确认过的指令」的哈希，指令和它对不上（新拉的、被别人改过的）先在设置里确认才跑，
 * 和 Lua 片段的批准（lua-debug/snippets.ts）一个道理。自己在网页上保存的算确认过。
 */
export const SHARED_KEYS = ['full', 'incremental', 'cwd', 'scriptDir', 'errorFormat'] as const
type SharedKey = (typeof SHARED_KEYS)[number]
export type SharedLuaBuild = Partial<Pick<LuaBuildConfig, SharedKey>>

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

/** 确认认的是真正会执行的三样：两条指令和工作目录 */
const commandHash = (s: SharedLuaBuild) =>
  createHash('sha256')
    .update(JSON.stringify([s.full ?? '', s.incremental ?? '', s.cwd ?? '']))
    .digest('hex')

const approvedFile = (id: string) => path.join(c().dataDir, 'lua-build-approved', `${encodeURIComponent(id)}.json`)

export async function approveLuaBuild(id: string, s: SharedLuaBuild) {
  await writeJson(approvedFile(id), { hash: commandHash(s) })
}

/** 指令本机确认过没有：没配指令、或者和确认过的一样才算 */
export async function luaBuildApproved(p: Pick<UeProject, 'id' | 'luaBuild'>) {
  const s = sharedPart(p.luaBuild)
  if (!s.full && !s.incremental) return true
  return (await readJson<{ hash?: string }>(approvedFile(p.id), {})).hash === commandHash(s)
}

/**
 * 读项目时调：把文档根里的共用设置合进 p.luaBuild。strip=true 表示本机登记里还留着共用字段（升级前存的），
 * 已经搬进文档根，调用方把登记重写成只剩个人那部分。
 * 一次性搬家：文档根还没有这个文件就把本机那份写过去；本机的指令就是你自己配的，和文档根里的一样就记成确认过
 */
export async function mergeLuaBuild(p: UeProject): Promise<{ luaBuild?: Partial<LuaBuildConfig>; strip: boolean }> {
  const file = luaBuildFile(p)
  let shared = sharedPart(await readJson<SharedLuaBuild>(file.read, {}))
  const own = sharedPart(p.luaBuild)
  const strip = Object.keys(own).length > 0
  if (strip) {
    if (!existsSync(file.read)) {
      await writeJson(file.write, own)
      shared = own
    }
    if (commandHash(own) === commandHash(shared)) await approveLuaBuild(p.id, own)
  }
  const merged = { ...localPart(p.luaBuild), ...shared }
  return { luaBuild: Object.keys(merged).length ? merged : undefined, strip }
}

/** 网页上保存：共用部分改了才写文档根（只改了个人习惯不往仓库里写文件）；保存就是你看过这些指令，记成本机确认过 */
export async function saveSharedLuaBuild(p: P, next: SharedLuaBuild, changed: boolean) {
  if (changed) await writeJson(luaBuildFile(p).write, sharedPart(next))
  await approveLuaBuild(p.id, next)
}
