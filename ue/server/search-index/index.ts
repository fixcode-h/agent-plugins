import path from 'node:path'
import type { UeProject } from '../types.ts'
import { assetScanner, diskAssets, diskLua, luaScanner, type DiskScanner } from './disk.ts'
import { projectMounts } from './mounts.ts'
import type { IndexAsset, IndexLua, SearchIndex } from './types.ts'
import {
  findIndexFile,
  readUetovsAssets,
  readUetovsLua,
  solutionDirs,
  UETOVS_ASSETS,
  UETOVS_LUA,
  type Found,
} from './uetovs.ts'

/**
 * 跳转弹窗的本地索引：先用 UEToVS 建好的索引文件（按修改时间和大小判断要不要重读），没有再自己扫磁盘（按目录增量）。
 * 每个项目在内存里留一份；几秒内重复来问直接给上次的，同时来的请求共用一次构建
 */

/** 多久内再来问不重新检查（连按几次快捷键不重复扫） */
const FRESH_MS = 3000

interface Part<T> {
  /** 这份数据对应的 UEToVS 文件（时间 + 大小），或磁盘扫描的代数 */
  key: string
  data: T[]
  source: 'uetovs' | 'disk' | 'none'
  file?: string
}

interface Cache {
  at: number
  index?: SearchIndex
  building?: Promise<SearchIndex>
  assets?: Part<IndexAsset>
  lua?: Part<IndexLua>
  assetDisk: DiskScanner
  luaDisk: DiskScanner
}

const caches = new Map<string, Cache>()

const fileKey = (f: Found) => `u:${f.file}:${f.mtimeMs}:${f.size}`

async function buildAssets(p: UeProject, c: Cache, dirs: string[]): Promise<Part<IndexAsset>> {
  const mounts = await projectMounts(p.root)
  const found = await findIndexFile(dirs, UETOVS_ASSETS, p.root)
  if (found) {
    const key = fileKey(found)
    if (c.assets?.key === key) return c.assets
    const data = await readUetovsAssets(found, p.root, mounts)
    if (data) return { key, data, source: 'uetovs', file: found.file }
  }
  const data = await diskAssets(c.assetDisk, mounts, p.id)
  return { key: `d:${c.assetDisk.generation}`, data, source: 'disk' }
}

async function buildLua(p: UeProject, c: Cache, dirs: string[]): Promise<Part<IndexLua>> {
  const found = await findIndexFile(dirs, UETOVS_LUA, p.root)
  if (found) {
    const key = fileKey(found)
    if (c.lua?.key === key) return c.lua
    const data = await readUetovsLua(found, p.root)
    if (data) return { key, data, source: 'uetovs', file: found.file }
  }
  // 和 Lua 编译设置的脚本目录一致（默认 Content/Script）；没有这个目录的项目就是没有 Lua
  const scriptDir = path.resolve(p.root, p.luaBuild?.scriptDir || 'Content/Script')
  const data = await diskLua(c.luaDisk, scriptDir, p.id)
  return { key: `d:${c.luaDisk.generation}`, data, source: data.length ? 'disk' : 'none' }
}

async function build(p: UeProject, c: Cache): Promise<SearchIndex> {
  const t0 = Date.now()
  const dirs = solutionDirs(p)
  const [assets, lua] = await Promise.all([buildAssets(p, c, dirs), buildLua(p, c, dirs)])
  const version = `${assets.key}|${lua.key}`
  c.assets = assets
  c.lua = lua
  if (c.index?.version === version) return c.index
  return {
    version,
    assets: assets.data,
    lua: lua.data,
    source: { assets: assets.source === 'uetovs' ? 'uetovs' : 'disk', lua: lua.source },
    files: { assets: assets.file, lua: lua.file },
    builtAt: new Date().toISOString(),
    ms: Date.now() - t0,
  }
}

export async function searchIndex(p: UeProject, force = false): Promise<SearchIndex> {
  let c = caches.get(p.id)
  if (!c) caches.set(p.id, (c = { at: 0, assetDisk: assetScanner(), luaDisk: luaScanner() }))
  if (c.building) return c.building
  if (c.index && !force && Date.now() - c.at < FRESH_MS) return c.index
  const cache = c
  cache.building = build(p, cache)
    .then((idx) => {
      cache.index = idx
      cache.at = Date.now()
      return idx
    })
    .finally(() => {
      cache.building = undefined
    })
  return cache.building
}

/**
 * GET search-index?v=<上次的版本>：版本没变只回 { version, same: true }，网页接着用手里那份；
 * refresh=1 不管几秒内问过都重新检查
 */
export async function searchIndexRoute(p: UeProject, route: string, url: URL) {
  if (route !== 'GET search-index') return undefined
  const idx = await searchIndex(p, url.searchParams.get('refresh') === '1')
  if (url.searchParams.get('v') === idx.version) return { version: idx.version, same: true }
  return idx
}
