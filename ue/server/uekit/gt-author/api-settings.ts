import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { UeProject } from '../../types.ts'
import { scenarioRoot } from '../gt-disk.ts'
import { DEFAULT_LUA_API } from './api-lua.ts'
import { API_FILE, luaApiFolders, readApiFile, writeLuaApi } from './api-file.ts'
import { luaRoot } from './lua-files.ts'

/**
 * GameTest 设置页「接口库」（用户 2026-11-18：插件设置里能配 Lua 函数库接口的文件夹）：
 * 读写场景根 `_settings.json` 的 `api.lua` / `api.cpp`，只动这两项，别的运行配置原样保留；编辑器没开也能改。
 * 存完马上重扫 Lua 接口写 _api.json，页面上直接看到每个文件夹认出了几个、哪些函数没认出来和原因。
 */
export const DEFAULT_CPP_API = ['Source/**/GameTestApi']

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

const cleanList = (v: unknown) =>
  Array.isArray(v)
    ? [
        ...new Set(
          v
            .filter((x): x is string => typeof x === 'string')
            .map((x) => x.trim().replace(/\\/g, '/'))
            .filter(Boolean),
        ),
      ]
    : undefined

async function readSettings(file: string): Promise<Obj> {
  const text = await readFile(file, 'utf8').catch(() => '')
  if (!text.trim()) return {}
  try {
    const v = JSON.parse(text.replace(/^﻿/, '')) as unknown
    if (isObj(v)) return v
  } catch {
    // 落到下面统一报错
  }
  throw new Error('运行配置 _settings.json 不是合法的 JSON：先在 GameTest 设置里修好再改接口文件夹')
}

async function summary(p: UeProject, scen: string) {
  const settings = await readSettings(path.join(scen, '_settings.json'))
  const api = isObj(settings.api) ? settings.api : {}
  const doc = await readApiFile(scen)
  const cpp = isObj(doc.cpp) ? doc.cpp : {}
  return {
    settingsPath: path.join(scen, '_settings.json').replace(/\\/g, '/'),
    luaRoot: luaRoot(p).replace(/\\/g, '/'),
    lua: cleanList(api.lua) ?? DEFAULT_LUA_API,
    luaIsDefault: !Array.isArray(api.lua),
    cpp: cleanList(api.cpp) ?? DEFAULT_CPP_API,
    cppIsDefault: !Array.isArray(api.cpp),
    cppScan: {
      scannedAt: typeof cpp.scannedAt === 'string' ? cpp.scannedAt : '',
      items: Array.isArray(cpp.items) ? cpp.items.length : 0,
      rejected: Array.isArray(cpp.rejected) ? cpp.rejected.slice(0, 50) : [],
    },
  }
}

/** POST ext/gt/api：action = read（设置 + 上次 C++ 扫描 + 现扫一遍 Lua）/ save（写文件夹再扫）/ scan（只重扫 Lua）/ file（只读 _api.json） */
export async function apiSettingsAction(p: UeProject, b: Obj) {
  const scen = await scenarioRoot(p.root)
  if (b.action === 'file') {
    const doc = await readApiFile(scen)
    return { path: path.join(scen, API_FILE).replace(/\\/g, '/'), exists: !!(doc.cpp || doc.lua), doc }
  }
  if (b.action === 'save') {
    const file = path.join(scen, '_settings.json')
    const settings = await readSettings(file)
    const api: Obj = isObj(settings.api) ? { ...settings.api } : {}
    for (const k of ['lua', 'cpp'] as const) {
      // null = 恢复默认（删掉这一项）；数组照存，空数组就是不扫这一种
      if (b[k] === null) delete api[k]
      else {
        const list = cleanList(b[k])
        if (list) api[k] = list
      }
    }
    const next: Obj = { ...settings, api }
    if (!Object.keys(api).length) delete next.api
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, '\t') + '\n', 'utf8')
    await rename(tmp, file)
  }
  const lua = await writeLuaApi(scen, luaRoot(p))
  return {
    ...(await summary(p, scen)),
    luaScan: {
      folders: await luaApiFolders(scen),
      written: lua.written,
      items: lua.counts.items,
      rejected: (lua.section.rejected as unknown[]).slice(0, 50),
      missing: lua.missing ?? [],
      perFolder: lua.section.perFolder ?? {},
      renamed: lua.renamed,
      apiPath: lua.path,
    },
  }
}
