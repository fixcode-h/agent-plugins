import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Card } from './instances.ts'
import { indexedTree } from './file-index.ts'
import { exists, t } from './util.ts'

/**
 * assets.children 的数据结构和不碰桥接的那一半（磁盘兜底、选进程）：单独一个文件，
 * 单测不用拉起整个插件（instances.ts 会连带引入面板模块）。转发桥接在 asset-folders.ts
 */
export interface ChildFolder {
  name: string
  /** 包路径：/Game/Data、/<插件>/... */
  path: string
  /** 直接子项数（子文件夹 + 资源）；读不到就不给 */
  count?: number
  /** 只在挂载根（path 为 '/'）上：项目内容、项目插件、引擎（含引擎插件） */
  root?: 'game' | 'plugin' | 'engine'
}
export interface ChildItem {
  name: string
  /** 对象路径，和 assets 操作返回的一样：/Game/A/BP_X.BP_X */
  path: string
  /** 类名；磁盘兜底认不出时是空串（.umap 写 World） */
  class: string
}
export interface Children {
  path: string
  folders: ChildFolder[]
  items: ChildItem[]
  /** 一层的子项超过 limit 被截断了 */
  more?: boolean
  /** 截断前的子项总数（磁盘兜底给；桥接可能不给） */
  total?: number
  source: 'bridge' | 'disk'
  /** 给界面的一句提示（引擎内容在磁盘上找不到、磁盘上没法按类型筛……） */
  note?: string
  /** 桥接的资源注册表还在扫盘，这一层可能不全，过一会儿重读 */
  loading?: boolean
}

export const CHILD_LIMIT = 500
/** 和 UELink 的上限一致（UEKit docs/protocol.md 的 assets.children） */
export const CHILD_MAX = 2000

export const normPath = (p: unknown) => {
  const s = String(p ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
  return s || '/'
}

/** 「这个进程不支持这个操作」：旧桥接、游戏进程（编辑器专用的操作）——这时改扫磁盘，不报错 */
export const unsupported = (msg: string) => /不支持|unknown|没有「assets\.children」/i.test(msg)

/**
 * 问哪个进程：网页上选了哪个就用它，否则编辑器 > 已经起来的后台编辑器 > 游戏进程（资源注册表在运行时模块里，
 * -game 也能答；专用服务器不问）。一个都没有就返回空，走磁盘
 */
export function pickAssetCard(cards: Card[], want?: string | number) {
  const rank = (k: string) => ['editor', 'background', 'game'].indexOf(k)
  const list = cards.filter((c) => rank(c.kind) >= 0).sort((a, b) => rank(a.kind) - rank(b.kind))
  if (want !== undefined && want !== '') {
    const hit = list.find((c) => String(c.pid) === String(want) || c.kind === want)
    if (hit) return hit
  }
  return list[0]
}

// ---------- 磁盘兜底 ----------

export interface Mount {
  /** 挂载名（插件名，.uplugin 的文件名） */
  name: string
  /** 插件的 Content 目录 */
  dir: string
}

/** 扫插件目录太深没意义：插件一般在 Plugins/<分组>/<插件>/，6 层够了 */
const MAX_DEPTH = 6
/** 插件目录里不会再嵌插件的子目录，跳过省得白读 */
const SKIP_DIRS = new Set(['binaries', 'intermediate', 'saved', 'source', 'content', 'resources', 'config', '.git'])

/** 项目插件里能放内容的（CanContainContent 且有 Content 目录），按名字排 */
export async function projectPlugins(root: string): Promise<Mount[]> {
  const out: Mount[] = []
  // 面板有项目文件索引时直接拿 Plugins 下的 .uplugin（只认最外层的：插件里面不会再有插件）
  const plugins = path.join(root, 'Plugins')
  const listed = await indexedTree(plugins, /\.uplugin$/i)
  if (listed) {
    const dirs = listed
      .map((r) => r.split('/').slice(0, -1).join('/'))
      .filter((d, _i, all) => d.split('/').length <= MAX_DEPTH && !all.some((o) => o !== d && d.startsWith(`${o}/`)))
    for (const d of [...new Set(dirs)]) {
      const dir = path.join(plugins, ...d.split('/'))
      const up = listed.find((r) => r.split('/').slice(0, -1).join('/') === d)!
      const desc = await readFile(path.join(plugins, ...up.split('/')), 'utf8')
        .then((s) => JSON.parse(s.replace(/^﻿/, '')) as { CanContainContent?: boolean })
        .catch(() => ({}) as { CanContainContent?: boolean })
      const content = path.join(dir, 'Content')
      if (desc.CanContainContent && exists(content))
        out.push({ name: up.split('/').pop()!.replace(/\.uplugin$/i, ''), dir: content })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }
  const walk = async (dir: string, depth: number) => {
    const ents = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const up = ents.find((e) => e.isFile() && /\.uplugin$/i.test(e.name))
    if (up) {
      const desc = await readFile(path.join(dir, up.name), 'utf8')
        .then((s) => JSON.parse(s.replace(/^﻿/, '')) as { CanContainContent?: boolean })
        .catch(() => ({}) as { CanContainContent?: boolean })
      const content = path.join(dir, 'Content')
      if (desc.CanContainContent && exists(content))
        out.push({ name: up.name.replace(/\.uplugin$/i, ''), dir: content })
      // 插件里面不会再有插件
      return
    }
    if (depth >= MAX_DEPTH) return
    await Promise.all(
      ents
        .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name.toLowerCase()) && !e.name.startsWith('.'))
        .map((e) => walk(path.join(dir, e.name), depth + 1)),
    )
  }
  await walk(path.join(root, 'Plugins'), 0)
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const ASSET_FILE = /\.(uasset|umap)$/i

/** 一个目录下直接的子项数（子文件夹 + 资源文件）；读不了就不给 */
async function countIn(dir: string) {
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => undefined)
  if (!ents) return undefined
  return ents.filter((e) => (e.isDirectory() && !e.name.startsWith('.')) || (e.isFile() && ASSET_FILE.test(e.name)))
    .length
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })

/**
 * 资源文件夹（包路径 /Game/A、/<插件>/A、/Engine/A）在磁盘上的目录。引擎内容目录找不到时返回空串；
 * 认不出挂载点、路径里有 .. 时抛错
 */
function mapDir(p: string, root: string, plugins: Mount[], engineContent: string) {
  const [, mount = '', ...rest] = p.split('/')
  let base = ''
  if (mount.toLowerCase() === 'game') base = path.join(root, 'Content')
  else if (mount.toLowerCase() === 'engine') {
    if (!engineContent) return ''
    base = engineContent
  } else {
    const m = plugins.find((x) => x.name.toLowerCase() === mount.toLowerCase())
    if (!m) throw new Error(t('找不到挂载点 /{m}：项目插件里没有能放内容的这个插件', { m: mount }))
    base = m.dir
  }
  // 不许用 .. 走出 Content
  if (rest.some((s) => s === '..' || s === '.')) throw new Error(t('路径不对：{p}', { p }))
  return path.join(base, ...rest)
}

/** 给文件夹内容表 stat 文件用（asset-folders-stat.ts）：资源文件夹 → 磁盘目录，找不到返回空串 */
export async function contentDir(root: string, engineDir: string, p: string) {
  p = normPath(p)
  if (p === '/') return ''
  const engineContent = engineDir ? path.join(engineDir, 'Engine', 'Content') : ''
  return mapDir(p, root, await projectPlugins(root), engineContent && exists(engineContent) ? engineContent : '')
}

/**
 * 扫磁盘列一层：/Game → <项目>/Content，/<插件> → 插件的 Content，/Engine → <引擎>/Engine/Content。
 * 磁盘上认不出类型：.umap 写 World，其他留空串；按类型筛选时只认得出 World，别的类型只列文件夹并带提示
 */
export async function diskChildren(
  root: string,
  engineDir: string,
  p: string,
  cls = '',
  limit = CHILD_LIMIT,
): Promise<Children> {
  p = normPath(p)
  const plugins = await projectPlugins(root)
  const engineContent = engineDir ? path.join(engineDir, 'Engine', 'Content') : ''
  const engineOk = !!engineContent && exists(engineContent)
  if (p === '/') {
    const folders: ChildFolder[] = [
      { name: 'Game', path: '/Game', count: await countIn(path.join(root, 'Content')), root: 'game' },
      ...(await Promise.all(
        plugins.map(async (m) => ({
          name: m.name,
          path: `/${m.name}`,
          count: await countIn(m.dir),
          root: 'plugin' as const,
        })),
      )),
      { name: 'Engine', path: '/Engine', count: engineOk ? await countIn(engineContent) : undefined, root: 'engine' },
    ]
    return { path: '/', folders, items: [], source: 'disk' }
  }

  const dir = mapDir(p, root, plugins, engineOk ? engineContent : '')
  if (!dir) return { path: p, folders: [], items: [], source: 'disk', note: t('引擎内容要编辑器开着才能列') }
  const ents = await readdir(dir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') throw new Error(t('磁盘上没有这个文件夹：{p}', { p }))
    throw new Error(t('读不了文件夹 {p}：{msg}', { p, msg: e.message }))
  })

  const folderEnts = ents.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  let items: ChildItem[] = ents
    .filter((e) => e.isFile() && ASSET_FILE.test(e.name))
    .map((e) => {
      const name = e.name.replace(ASSET_FILE, '')
      return { name, path: `${p}/${name}.${name}`, class: /\.umap$/i.test(e.name) ? 'World' : '' }
    })
  let note: string | undefined
  if (cls) {
    if (cls === 'World') items = items.filter((i) => i.class === 'World')
    else {
      items = []
      note = t('编辑器没开，磁盘上认不出资源类型：按类型筛选要编辑器开着，现在只列文件夹')
    }
  }
  folderEnts.sort(byName)
  items.sort(byName)
  const total = folderEnts.length + items.length
  // 先给文件夹再给资源，超过上限截断（一层几千个时网页画不过来，用资源页树上方的搜索框找）
  const keepFolders = folderEnts.slice(0, limit)
  const keepItems = items.slice(0, Math.max(0, limit - keepFolders.length))
  const folders = await Promise.all(
    keepFolders.map(async (e) => ({
      name: e.name,
      path: `${p}/${e.name}`,
      count: await countIn(path.join(dir, e.name)),
    })),
  )
  const out: Children = { path: p, folders, items: keepItems, source: 'disk' }
  if (total > folders.length + keepItems.length) {
    out.more = true
    out.total = total
  }
  if (note) out.note = note
  return out
}

/**
 * 游戏进程（-game，非 Shipping 的未烹饪运行）的资源注册表不会像编辑器那样启动时扫全盘，
 * 只认得已经加载过或被显式扫过的包：直接用它列，没加载过的文件夹就显示成空的（用户 2026-11-19「有些文件夹展开显示为空」）。
 * 这时把磁盘上列到的并进来：文件夹、资源取并集，类型以注册表的为准（磁盘认不出类型）
 */
export function mergeWithDisk(bridge: Children, disk: Children): Children {
  const folders = new Map(bridge.folders.map((f) => [f.path.toLowerCase(), f]))
  for (const f of disk.folders) if (!folders.has(f.path.toLowerCase())) folders.set(f.path.toLowerCase(), f)
  const items = new Map(bridge.items.map((i) => [i.path.toLowerCase(), i]))
  for (const i of disk.items) if (!items.has(i.path.toLowerCase())) items.set(i.path.toLowerCase(), i)
  const out: Children = {
    ...bridge,
    folders: [...folders.values()].sort(byName),
    items: [...items.values()].sort(byName),
  }
  if (disk.more || bridge.more) {
    out.more = true
    out.total = Math.max(bridge.total ?? 0, disk.total ?? 0) || undefined
  }
  return out
}
