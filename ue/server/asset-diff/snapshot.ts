import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileAt, fileHistory, type FileHistory } from '@panel/server/exec/vcs-history'
import { assetDiff } from '../../shared/asset-diff/diff.ts'
import type { AssetDiff, AssetSnap } from '../../shared/asset-diff/types.ts'
import { packageToDisk } from '../asset-query.ts'
import { BridgeError, type Card } from '../instances.ts'
import type { StepId } from '../../shared/asset-diff/progress.ts'
import { DiffTracker } from './progress.ts'
import { DiffReadError, pickReader } from './reader.ts'
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
async function bridgeSnapshot(project: UeProject, card: Card, pkg: string, file?: string): Promise<string> {
  const out = path.join(project.root, 'Saved', 'AgentPanel', 'snapshot', `${randomBytes(6).toString('hex')}.json`)
  await mkdir(path.dirname(out), { recursive: true })
  try {
    await runOp(
      // 固定发给挑好的进程（reader.ts），不跟 UE 页记住的目标走
      { project, actor: { kind: 'user' }, target: { instance: card.pid } },
      'asset.snapshot',
      // 桥接按 UE 的习惯收正斜杠路径
      { package: pkg, out: out.replaceAll('\\', '/'), ...(file ? { file: file.replaceAll('\\', '/') } : {}) },
      300000,
    )
    return await readFile(out, 'utf8')
  } catch (e) {
    const msg = (e as Error).message
    // 旧桥接没有这个操作：说清楚怎么升级，而不是只说「不支持」（进程是 reader.ts 挑的编辑器 / 后台编辑器，不会是游戏进程）
    if (/不支持 asset\.snapshot|unknown.*asset\.snapshot/i.test(msg))
      throw new DiffReadError(
        'old-bridge',
        t('这个 UE 里的 UELink 是旧版本，读不了资源的版本差异：到「UE 插件」更新到 {v}，重新编译并重启 UE', {
          v: SNAPSHOT_BRIDGE,
        }),
      )
    throw e
  } finally {
    await rm(out, { force: true })
  }
}

const hashOf = (pkg: string, data: Buffer) => createHash('sha1').update(pkg).update('\0').update(data).digest('hex')

/** 一版字节交给桥接读成快照（调用方已经查过缓存） */
async function readBytes(project: UeProject, card: Card, pkg: string, data: Buffer, hash: string): Promise<AssetSnap> {
  // 放在项目的 Saved 下：后台编辑器和编辑器都能读到，用完整个目录删掉；文件名就是资源名（桥接按它找资源对象）
  const dir = path.join(project.root, 'Saved', 'AgentPanel', 'textify', randomBytes(6).toString('hex'))
  await mkdir(dir, { recursive: true })
  try {
    const file = path.join(dir, `${pkg.split('/').pop()}.uasset`)
    await writeFile(file, data)
    const text = await bridgeSnapshot(project, card, pkg, file)
    const snap = JSON.parse(text) as AssetSnap
    remember(hash, snap)
    await writeCache(hash, text).catch(() => {})
    return snap
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 一边的原始字节；那一版里没有这个文件时是 null。live（编辑器里的那份）没有字节 */
async function bytesOf(project: UeProject, pkg: string, src: SnapSource): Promise<Buffer | null> {
  const file = await assetFile(project.root, pkg)
  if ('disk' in src) return existsSync(file) ? readFile(file) : null
  if ('rev' in src) return fileAt(project.root, relOf(project.root, file), src.rev)
  return null
}

/** 编辑器 / 后台编辑器只挑一次：两边都要读时用同一个进程 */
type ReaderRef = { card?: Promise<Card>; startBackground?: boolean }

/** 一边的快照：取字节 → 查缓存 → 交给 UE 读，每步记进进度；那一版里没有这个文件时返回 null */
async function sideSnapshot(
  project: UeProject,
  pkg: string,
  src: SnapSource,
  tr: DiffTracker,
  steps: { fetch: StepId; read: StepId },
  ref: ReaderRef,
): Promise<AssetSnap | null> {
  const reader = () => {
    ref.card ??= pickReader(project, 'live' in src, ref.startBackground).then((card) => {
      tr.reader(card.kind, card.pid)
      return card
    })
    return ref.card
  }
  if ('live' in src) {
    tr.set(steps.fetch, { state: 'skip', detail: t('编辑器里的那份不用取文件') })
    const card = await reader()
    return tr.step(steps.read, async () => JSON.parse(await bridgeSnapshot(project, card, pkg)) as AssetSnap)
  }
  const data = await tr.step(
    steps.fetch,
    () => bytesOf(project, pkg, src),
    (d) =>
      d
        ? { detail: t('{size} · {how}', { size: sizeText(d.length), how: 'disk' in src ? t('磁盘上的文件') : t('从版本库取') }) }
        : { state: 'skip', detail: t('这一版里没有这个文件') },
  )
  if (!data) {
    tr.set(steps.read, { state: 'skip', detail: t('没有文件，整份算新加或删掉') })
    return null
  }
  const hash = hashOf(pkg, data)
  const hit = await readCache(hash)
  if (hit) {
    tr.set(steps.read, { state: 'skip', detail: t('本机缓存里有这一版的结构，跳过读取') })
    return hit
  }
  const card = await reader()
  return tr.step(steps.read, () => readBytes(project, card, pkg, data, hash))
}

const sizeText = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** 一边是什么的说明（进度里的步骤名用） */
const sideName = (src: SnapSource | null) =>
  !src ? t('（新建）') : 'live' in src ? t('编辑器里') : 'disk' in src ? t('磁盘上') : src.rev

/**
 * 两边的差异。两边都取不到文件时报错（版本号不对或者文件从来没提交过）。
 * opts.req / conn：网页给的请求号和推送连接，分步进度推给它，也按请求号取消
 */
export async function assetDiffFor(
  project: UeProject,
  pkg: string,
  from: SnapSource | null,
  to: SnapSource | null,
  opts: { req?: string; conn?: string; startBackground?: boolean } = {},
): Promise<AssetDiff> {
  const a = sideName(from)
  const b = sideName(to)
  const tr = new DiffTracker(opts.req ?? '', opts.conn, [
    { id: 'fetch-a', label: t('取 {v} 的文件', { v: a }) },
    { id: 'fetch-b', label: t('取 {v} 的文件', { v: b }) },
    { id: 'read-a', label: t('UE 读 {v} 的结构', { v: a }) },
    { id: 'read-b', label: t('UE 读 {v} 的结构', { v: b }) },
    { id: 'compare', label: t('比较') },
  ])
  try {
    const ref: ReaderRef = { startBackground: opts.startBackground }
    // 一开始就标出不用做的步骤，别让人以为还要等它
    if (!from) for (const id of ['fetch-a', 'read-a'] as const) tr.set(id, { state: 'skip', detail: t('这一版之前没有这个资源') })
    if (to && 'live' in to) tr.set('fetch-b', { state: 'skip', detail: t('编辑器里的那份不用取文件') })
    // 一个一个来：两版都要 UE 加载时并发也只是排队，先后取还能先用上缓存
    const sa = from ? await sideSnapshot(project, pkg, from, tr, { fetch: 'fetch-a', read: 'read-a' }, ref) : null
    const sb = to ? await sideSnapshot(project, pkg, to, tr, { fetch: 'fetch-b', read: 'read-b' }, ref) : null
    if (!sa && !sb) throw new BridgeError(t('两边都没有这个资源文件：可能还没提交过，或者路径变了'))
    return await tr.step('compare', async () => assetDiff(sa, sb))
  } finally {
    tr.end()
  }
}

/** 只要一边的快照（属性来历逐版往回读用）：有缓存直接用 */
export async function snapshotOf(project: UeProject, pkg: string, src: SnapSource): Promise<AssetSnap | null> {
  const tr = new DiffTracker('', undefined, [
    { id: 'fetch-a', label: '' },
    { id: 'read-a', label: '' },
  ])
  try {
    return await sideSnapshot(project, pkg, src, tr, { fetch: 'fetch-a', read: 'read-a' }, {})
  } finally {
    tr.end()
  }
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
