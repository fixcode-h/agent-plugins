import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileAt, fileHistory, type FileHistory } from '@panel/server/exec/vcs-history'
import { assetDiff } from '../../shared/asset-diff/diff.ts'
import type { AssetDiff, AssetSnap } from '../../shared/asset-diff/types.ts'
import { packageToDisk } from '../asset-query.ts'
import { BridgeError } from '../instances.ts'
import { runOp } from '../ops.ts'
import type { UeProject } from '../types.ts'
import { c, t } from '../util.ts'

/**
 * 资源页「版本差异」（设计稿 UE资源版本差异）：版本记录走面板的 vcs-history；点开一条记录时才取那两版的字节，
 * 交给桥接 asset.snapshot（UELink 2.14）在编辑器（没开就是后台编辑器）里读成结构化快照，再按 shared/asset-diff 逐项比。
 * 快照按文件内容的哈希记在数据目录：提交过的版本不会再变，再看同一版不用再起编辑器加载。
 */

/** 有 asset.snapshot 的桥接版本 */
export const SNAPSHOT_BRIDGE = '2.14.0'
/** 数据目录里最多留这么多份快照，多了删最旧的 */
const DISK_CACHE_MAX = 300
const MEM_CACHE_MAX = 16

/** 一边是什么：某个版本、磁盘上的文件、编辑器里的那份（含没保存的改动） */
export type SnapSource = { rev: string } | { disk: true } | { live: true }

const mem = new Map<string, AssetSnap>() // 模块状态：最近用过的快照，丢了从数据目录或重新读

function remember(key: string, snap: AssetSnap) {
  mem.set(key, snap)
  while (mem.size > MEM_CACHE_MAX) mem.delete(mem.keys().next().value!)
}

const cacheDir = () => path.join(c().dataDir, 'asset-snap')

/** 包路径 → 磁盘上的 .uasset：/Game 在 Content；插件的挂载点在 Plugins 下找同名、带 Content 的目录（最多往下 3 层） */
export async function assetFile(root: string, pkg: string): Promise<string> {
  const p = String(pkg).split('.')[0]
  const game = packageToDisk(root, p)
  if (game) return game
  const m = /^\/([^/]+)\/(.+)$/.exec(p)
  if (!m) throw new BridgeError(t('{p} 不是资源路径', { p: pkg }))
  const find = async (dir: string, depth: number): Promise<string> => {
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      return ''
    }
    for (const n of names) {
      const sub = path.join(dir, n)
      if (n.toLowerCase() === m[1].toLowerCase() && existsSync(path.join(sub, 'Content'))) return sub
      if (depth > 0 && !n.startsWith('.')) {
        const hit = await find(sub, depth - 1).catch(() => '')
        if (hit) return hit
      }
    }
    return ''
  }
  const plugin = await find(path.join(root, 'Plugins'), 3)
  if (!plugin) throw new BridgeError(t('找不到 {p} 在磁盘上的文件', { p: pkg }))
  return path.join(plugin, 'Content', ...m[2].split('/')) + '.uasset'
}

const relOf = (root: string, file: string) => path.relative(root, file).replaceAll('\\', '/')

/** 这个资源文件的版本记录 */
export async function assetHistory(project: UeProject, pkg: string): Promise<FileHistory & { file: string }> {
  const file = await assetFile(project.root, pkg)
  return { file: relOf(project.root, file), ...(await fileHistory(project.root, relOf(project.root, file))) }
}

async function readCache(hash: string): Promise<AssetSnap | null> {
  const hit = mem.get(hash)
  if (hit) return hit
  try {
    const snap = JSON.parse(await readFile(path.join(cacheDir(), `${hash}.json`), 'utf8')) as AssetSnap
    remember(hash, snap)
    return snap
  } catch {
    return null
  }
}

async function writeCache(hash: string, text: string) {
  const dir = cacheDir()
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${hash}.json`), text)
  // 超过上限删最旧的：按修改时间
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json'))
  if (names.length <= DISK_CACHE_MAX) return
  const aged = await Promise.all(names.map(async (n) => ({ n, at: (await stat(path.join(dir, n))).mtimeMs })))
  aged.sort((x, y) => x.at - y.at)
  for (const { n } of aged.slice(0, names.length - DISK_CACHE_MAX)) await unlink(path.join(dir, n)).catch(() => {})
}

/** 交给桥接：file 给了就读那一版的临时文件，不给就读编辑器里的；快照写在项目的 Saved 下，读完删掉 */
async function bridgeSnapshot(project: UeProject, pkg: string, file?: string): Promise<string> {
  const out = path.join(project.root, 'Saved', 'AgentPanel', 'snapshot', `${randomBytes(6).toString('hex')}.json`)
  await mkdir(path.dirname(out), { recursive: true })
  try {
    await runOp(
      { project, actor: { kind: 'user' } },
      'asset.snapshot',
      // 桥接按 UE 的习惯收正斜杠路径
      { package: pkg, out: out.replaceAll('\\', '/'), ...(file ? { file: file.replaceAll('\\', '/') } : {}) },
      300000,
    )
    return await readFile(out, 'utf8')
  } catch (e) {
    const msg = (e as Error).message
    // 旧桥接没有这个操作：说清楚怎么升级，而不是只说「不支持」
    if (/不支持 asset\.snapshot|unknown.*asset\.snapshot/i.test(msg))
      throw new BridgeError(
        t('这个 UE 里的 UELink 是旧版本，读不了资源的版本差异：到「UE 插件」更新到 {v}，重新编译并重启 UE', {
          v: SNAPSHOT_BRIDGE,
        }),
      )
    throw e
  } finally {
    await rm(out, { force: true })
  }
}

/** 一版字节的快照：先查缓存，没有就写成临时文件交给桥接 */
async function snapshotOfBytes(project: UeProject, pkg: string, data: Buffer): Promise<AssetSnap> {
  const hash = createHash('sha1').update(pkg).update('\0').update(data).digest('hex')
  const hit = await readCache(hash)
  if (hit) return hit
  // 放在项目的 Saved 下：后台编辑器和编辑器都能读到，用完整个目录删掉；文件名就是资源名（桥接按它找资源对象）
  const dir = path.join(project.root, 'Saved', 'AgentPanel', 'textify', randomBytes(6).toString('hex'))
  await mkdir(dir, { recursive: true })
  try {
    const file = path.join(dir, `${pkg.split('/').pop()}.uasset`)
    await writeFile(file, data)
    const text = await bridgeSnapshot(project, pkg, file)
    const snap = JSON.parse(text) as AssetSnap
    remember(hash, snap)
    await writeCache(hash, text).catch(() => {})
    return snap
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 一边的快照；那一版里没有这个文件时返回 null（整份算新加 / 删掉） */
export async function snapshotOf(project: UeProject, pkg: string, src: SnapSource): Promise<AssetSnap | null> {
  const file = await assetFile(project.root, pkg)
  if ('live' in src) return JSON.parse(await bridgeSnapshot(project, pkg)) as AssetSnap
  if ('disk' in src) {
    if (!existsSync(file)) return null
    return snapshotOfBytes(project, pkg, await readFile(file))
  }
  const data = await fileAt(project.root, relOf(project.root, file), src.rev)
  return data ? snapshotOfBytes(project, pkg, data) : null
}

/** 两边的差异。两边都取不到文件时报错（版本号不对或者文件从来没提交过） */
export async function assetDiffFor(
  project: UeProject,
  pkg: string,
  from: SnapSource | null,
  to: SnapSource | null,
): Promise<AssetDiff> {
  // 一个一个来：两版都要起编辑器加载时并发也只是排队，先后取还能先用上缓存
  const a = from ? await snapshotOf(project, pkg, from) : null
  const b = to ? await snapshotOf(project, pkg, to) : null
  if (!a && !b) throw new BridgeError(t('两边都没有这个资源文件：可能还没提交过，或者路径变了'))
  return assetDiff(a, b)
}

/** 网页传来的一边：'disk' / 'live' / 版本号；null 是「没有这一版」（看第一次提交时它的上一版） */
export function parseSource(v: unknown): SnapSource | null {
  if (v === null) return null
  if (v === 'disk') return { disk: true }
  if (v === 'live') return { live: true }
  const rev = String(v ?? '')
  if (!rev) throw new BridgeError(t('缺少要比的版本'))
  return { rev }
}
