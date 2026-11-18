import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { UeProject } from '../types.ts'
import { t } from '../util.ts'
import { parseLuaApi, type LuaApiItem, type LuaApiRejected } from './gt-api-lua.ts'
import { insideProject, within } from './gt-paths.ts'

/**
 * GameTest 接口库的磁盘部分（协议 8.2）：场景根的 _api.json（C++ 段 GameTest 编辑器模块扫，Lua 段面板扫，各写各的），
 * 接口库页编辑器没开时也能看项目接口；「重扫 Lua 接口」由这里扫 api.lua 文件夹写回 lua 段，不碰 cpp 段。
 */
const API_FILE = '_api.json'
const SETTINGS_FILE = '_settings.json'
const DEFAULT_LUA = ['GameTestApi']
const MAX_FILES = 2000

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  const text = await readFile(file, 'utf8').catch(() => undefined)
  if (text === undefined) return undefined
  try {
    const v = JSON.parse(text.replace(/^﻿/, '')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
  } catch {
    throw new Error(t('{f} 不是合法的 JSON', { f: path.basename(file) }))
  }
}

/** _settings.json 的 api.lua 文件夹（相对 Lua 脚本根），没写用默认 GameTestApi */
async function luaFolders(rootAbs: string) {
  const s = await readJson(path.join(rootAbs, SETTINGS_FILE)).catch(() => undefined)
  const api = s?.api as { lua?: unknown } | undefined
  const list = Array.isArray(api?.lua) ? api.lua.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
  return list.length ? list : DEFAULT_LUA
}

async function listLua(dir: string, out: string[]) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (out.length >= MAX_FILES) return
    const f = path.join(dir, e.name)
    if (e.isDirectory()) await listLua(f, out)
    else if (/\.lua$/i.test(e.name)) out.push(f)
  }
}

/** 读 _api.json：没有文件时给空的骨架 */
export async function readApiFile(p: UeProject, scenarioRoot: string) {
  const rootAbs = insideProject(p.root, scenarioRoot)
  const doc = (await readJson(path.join(rootAbs, API_FILE))) ?? {}
  return { path: path.join(scenarioRoot, API_FILE).replace(/\\/g, '/'), exists: Object.keys(doc).length > 0, doc }
}

/** 扫 Lua 接口文件夹，写回 _api.json 的 lua 段（dryRun 只返回结果不写） */
export async function scanLuaApi(p: UeProject, scenarioRoot: string, dryRun = false) {
  const rootAbs = insideProject(p.root, scenarioRoot)
  const scriptRoot = path.resolve(p.root, p.luaBuild?.scriptDir || 'Content/Script')
  const folders = await luaFolders(rootAbs)
  const items: LuaApiItem[] = []
  const rejected: LuaApiRejected[] = []
  const counts: Record<string, number> = {}
  for (const folder of folders) {
    const dir = path.resolve(scriptRoot, folder)
    if (!within(p.root, dir)) throw new Error(t('Lua 接口文件夹要在项目里：{f}', { f: folder }))
    const files: string[] = []
    await listLua(dir, files)
    let n = 0
    for (const f of files) {
      const module = path
        .relative(scriptRoot, f)
        .replace(/\\/g, '/')
        .replace(/\.lua$/i, '')
        .split('/')
        .join('.')
      const rel = path.relative(p.root, f).replace(/\\/g, '/')
      const r = parseLuaApi(await readFile(f, 'utf8'), module, rel)
      items.push(...r.items)
      rejected.push(...r.rejected)
      n += r.items.length
    }
    counts[folder] = n
  }
  const lua = { scannedAt: new Date().toISOString(), folders, items, rejected }
  let written = false
  if (!dryRun) {
    const file = path.join(rootAbs, API_FILE)
    const doc = (await readJson(file)) ?? { kind: 'gametest-api', version: 1 }
    // 结果和上次一样（不比扫描时间）就不写：不然每次扫都在版本库里留一个只改了时间的差异（协议第 8 节）
    const old = doc.lua as Record<string, unknown> | undefined
    const same = !!old && JSON.stringify([old.folders, old.items, old.rejected]) === JSON.stringify([folders, items, rejected])
    if (!same) {
      await writeFile(file, JSON.stringify({ ...doc, lua }, null, '\t') + '\n', 'utf8')
      written = true
    }
  }
  return { lua, counts, written }
}
