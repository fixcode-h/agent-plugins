import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_LUA_API, scanLuaApi, type LuaApiItem, type LuaApiSection } from './api-lua.ts'

/**
 * 场景根下的 `_api.json`（GameTest 脚本协议 8.2）：生成物，进版本库、不手改。按 src 分段，谁写谁那一段——
 * 面板只写 lua 段，cpp 段（编辑器里的 GameTestEditor 写）和其他字段原样保留。
 * 内容没变时不写（只差扫描时间也不写），免得每次扫描都让版本库里多一处改动。
 */
export const API_FILE = '_api.json'
const SETTINGS_FILE = '_settings.json'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

async function readJson(file: string): Promise<Obj | undefined> {
  const text = await readFile(file, 'utf8').catch(() => '')
  if (!text.trim()) return undefined
  try {
    const v = JSON.parse(text.replace(/^﻿/, '')) as unknown
    return isObj(v) ? v : undefined
  } catch {
    return undefined
  }
}

/** _settings.json 的 api.lua：没写用默认 GameTestApi；写了空数组就是不扫 Lua 接口 */
export async function luaApiFolders(scenarioRoot: string): Promise<string[]> {
  const s = await readJson(path.join(scenarioRoot, SETTINGS_FILE))
  const api = isObj(s?.api) ? s.api : undefined
  if (!api || !Array.isArray(api.lua)) return DEFAULT_LUA_API
  return api.lua.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim())
}

export async function readApiFile(scenarioRoot: string): Promise<Obj> {
  return (await readJson(path.join(scenarioRoot, API_FILE))) ?? { kind: 'gametest-api', version: 1 }
}

/**
 * 改名：旧的一项不见了、同一个文件里多出来的一项参数一样，就当改名，记进 renamed（旧名 → 新名），
 * 调用旧名时 GameTest 报「改用 …」。旧名后来又出现了就去掉这一条
 */
export function detectRenames(prev: LuaApiItem[], next: LuaApiItem[], renamed: Obj): Obj {
  const out: Obj = {}
  const names = new Set(next.map((x) => x.name))
  for (const [k, v] of Object.entries(renamed)) if (!names.has(k) && typeof v === 'string') out[k] = v
  const sig = (x: LuaApiItem) => `${x.file}|${x.args.map((a) => a.type).join(',')}`
  const old = new Set(prev.map((x) => x.name))
  const added = next.filter((x) => !old.has(x.name))
  for (const gone of prev.filter((x) => !names.has(x.name))) {
    const same = added.filter((x) => sig(x) === sig(gone))
    if (same.length === 1) out[gone.name] = same[0].name
  }
  return out
}

const comparable = (s: Obj | undefined) => (s ? JSON.stringify({ ...s, scannedAt: undefined }) : '')

/** 扫 Lua 接口并写回 lua 段；dryRun 只返回结果。返回写没写、条数和没认出来的 */
export async function writeLuaApi(scenarioRoot: string, luaRootAbs: string, dryRun = false) {
  const folders = await luaApiFolders(scenarioRoot)
  const scanned: LuaApiSection = await scanLuaApi(luaRootAbs, folders)
  const doc = await readApiFile(scenarioRoot)
  const prevLua = isObj(doc.lua) ? doc.lua : undefined
  const prevItems = (Array.isArray(prevLua?.items) ? prevLua.items : []) as LuaApiItem[]
  const renamed = detectRenames(prevItems, scanned.items, isObj(doc.renamed) ? doc.renamed : {})
  const lua: Obj = { scannedAt: new Date().toISOString(), ...scanned }
  const changed =
    comparable(prevLua) !== comparable(lua) || JSON.stringify(renamed) !== JSON.stringify(doc.renamed ?? {})
  const next: Obj = { kind: 'gametest-api', version: 1, ...doc, lua, renamed }
  if (!Object.keys(renamed).length) delete next.renamed
  const file = path.join(scenarioRoot, API_FILE)
  if (changed && !dryRun) {
    // 先写临时文件再换名：编辑器里的 GameTestEditor 同时在读时不会读到半份
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, '\t') + '\n', 'utf8')
    await rename(tmp, file)
  }
  return {
    path: file.replace(/\\/g, '/'),
    written: changed && !dryRun,
    folders,
    counts: { items: scanned.items.length, rejected: scanned.rejected.length },
    ...(scanned.missing ? { missing: scanned.missing } : {}),
    renamed,
    section: lua,
  }
}
