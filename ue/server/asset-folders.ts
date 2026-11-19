import { BridgeError, liveCards, rpc, type Card } from './instances.ts'
import { diskStats, mergeStats, p4Stats, type FolderStat, type StatItem } from './asset-folders-stat.ts'
import type { OpCtx } from './ops.ts'
import {
  CHILD_LIMIT,
  CHILD_MAX,
  contentDir,
  diskChildren,
  mergeWithDisk,
  normPath,
  pickAssetCard,
  projectPlugins,
  unsupported,
  type ChildFolder,
  type Children,
} from './asset-folders-disk.ts'

/**
 * 资源页「文件夹」页签的数据：assets.children（设计稿「对象页合并与资源导航」第 8 节）。
 * 一次只读一层（子文件夹 + 这一层的资源），点开文件夹才读下一层。
 * 有在跑的 UE 进程（编辑器、已经起来的后台编辑器、-game 进程，UELink 2.3.0 起放在运行时模块）且桥接认这个操作时
 * 问桥接（资源注册表，类型准）；
 * 否则直接扫磁盘上的 Content 目录——**不为它启动后台编辑器**：打开资源页就要看到文件夹，
 * 等 30–60 秒起后台编辑器只为列目录不值得，类型在点开资源时再读。
 * 这是界面用的，不做成 Agent 工具（面板 ADR 0067：Agent 用 ue_find / 读文件就能列资源）
 */

/** 不是资源内容的挂载点：脚本类、临时包、内存包，列出来也点不开 */
const NOT_CONTENT = new Set(['/Script', '/Temp', '/Memory', '/Config', '/Extra'])

/**
 * 资源页右栏「文件夹内容」表（设计稿「UE 插件优化与扩展」三.3）：在 assets.children 上加参数，不另开操作——
 * stat: true 给每个资源带上磁盘大小、修改时间、未保存、P4 签出；refs: true 只查引用者个数（慢，界面列出来后再单独要）。
 * 未保存和引用要编辑器（或已经起来的后台编辑器）答，没有就不给，也不为它起后台编辑器
 */
export async function assetChildren(
  ctx: OpCtx,
  args: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<Children & { stat?: FolderStat }> {
  const base = await listChildren(ctx, args, timeoutMs)
  if ((!args.stat && !args.refs) || base.path === '/') return base
  const card = editorCard(await liveCards(ctx.project.root), ctx.target?.instance)
  if (args.refs) {
    const { items, skipped } = await refCounts(card, base.items)
    return { ...base, items, stat: { editor: !!card, ...(skipped ? { refsSkipped: skipped } : {}) } }
  }
  const dir = await contentDir(
    ctx.project.root,
    ctx.project.engine?.dir || ctx.project.engineDir || '',
    base.path,
  ).catch(() => '')
  const [disk, vcs, dirty] = await Promise.all([
    diskStats(dir),
    ctx.project.vcs === 'p4' ? p4Stats(ctx.project.root, dir) : Promise.resolve({ map: new Map(), error: undefined }),
    card ? dirtySet(card) : Promise.resolve(undefined),
  ])
  const items: StatItem[] = mergeStats(base.items, disk, vcs.map).map((it) =>
    dirty ? { ...it, dirty: dirty.has(it.path.split('.')[0].toLowerCase()) } : it,
  )
  return { ...base, items, stat: { editor: !!dirty, ...(vcs.error ? { vcsError: vcs.error } : {}) } }
}

/** 未保存、引用只有编辑器模块答（UELinkEditor）：网页选了哪个用哪个，否则编辑器 > 已经起来的后台编辑器 */
function editorCard(cards: Card[], want?: string | number) {
  const list = cards.filter((c) => c.kind === 'editor' || c.kind === 'background')
  const hit = want !== undefined && want !== '' && list.find((c) => String(c.pid) === String(want) || c.kind === want)
  return hit || list.find((c) => c.kind === 'editor') || list[0]
}

/** 编辑器里改了没保存的包（小写包路径）；问不到返回空，状态列就不写「未保存」 */
async function dirtySet(card: Card) {
  try {
    const r = (await rpc(card, 'asset.dirty', {}, 15000)) as { items?: { package: string }[] }
    return new Set((r.items ?? []).map((i) => i.package.toLowerCase()))
  } catch {
    return undefined
  }
}

/** 一层最多查多少个资源的引用：一个资源一次 asset.refs，几百个已经要几秒 */
const REFS_MAX = 300
/** 地图是入口，本来就没人引用，标「未被引用」只会误导 */
const NO_REFS_CLASS = new Set(['World'])

/** 每个资源被几个包引用（资源注册表，含软引用）：同时最多 6 个请求，别把编辑器的游戏线程塞满 */
async function refCounts(card: Card | undefined, items: StatItem[]) {
  if (!card) return { items, skipped: 0 }
  const want = items.filter((i) => !NO_REFS_CLASS.has(i.class)).slice(0, REFS_MAX)
  const skipped = Math.max(0, items.filter((i) => !NO_REFS_CLASS.has(i.class)).length - want.length)
  const got = new Map<string, number>()
  let next = 0
  let broken = false
  const worker = async () => {
    while (!broken && next < want.length) {
      const it = want[next++]
      try {
        const r = (await rpc(card, 'asset.refs', { path: it.path, direction: 'referencers', limit: 1 }, 15000)) as {
          referencerTotal?: number
        }
        if (typeof r.referencerTotal === 'number') got.set(it.path, r.referencerTotal)
      } catch (e) {
        // 旧桥接不认这个操作：后面的也不用问了
        if (e instanceof BridgeError && unsupported(e.message)) broken = true
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return { items: items.map((i) => (got.has(i.path) ? { ...i, refs: got.get(i.path) } : i)), skipped }
}

async function listChildren(ctx: OpCtx, args: Record<string, unknown>, timeoutMs: number): Promise<Children> {
  const p = normPath(args.path)
  const cls = String(args.class ?? '').trim()
  const limit = clampLimit(args.limit)
  const card = pickAssetCard(await liveCards(ctx.project.root), ctx.target?.instance)
  const engineDir = ctx.project.engine?.dir || ctx.project.engineDir || ''
  if (card && (await supports(card))) {
    try {
      const res = (await rpc(card, 'assets.children', { path: p, class: cls, limit }, timeoutMs)) as unknown as Omit<
        Children,
        'source'
      >
      const out: Children = {
        path: p,
        folders: res.folders ?? [],
        items: res.items ?? [],
        more: res.more,
        total: res.total,
        note: res.note,
        loading: res.loading,
        source: 'bridge',
      }
      if (p === '/') out.folders = await tagRoots(ctx.project.root, out.folders)
      // 游戏进程的注册表不全（见 mergeWithDisk）：并上磁盘列到的；磁盘上没有这个目录（只在内存里的包）就只用注册表的
      else if (card.kind === 'game') {
        const disk = await diskChildren(ctx.project.root, engineDir, p, cls, limit).catch(() => undefined)
        if (disk) return mergeWithDisk(out, disk)
      }
      return out
    } catch (e) {
      // 名片说支持、实际调用又说不支持（/info 的 ops 列表和操作表对不上）：也走磁盘
      if (!(e instanceof BridgeError) || !unsupported(e.message)) throw e
    }
  }
  return diskChildren(ctx.project.root, engineDir, p, cls, limit)
}

function clampLimit(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), CHILD_MAX) : CHILD_LIMIT
}

/** 进程认不认 assets.children：看桥接 /info 的 ops 列表，一个进程问一次（按 PID + 启动时间记） */
const opsSeen = new Map<string, boolean>()
async function supports(card: Card) {
  const key = `${card.pid}|${card.startedAt}`
  const hit = opsSeen.get(key)
  if (hit !== undefined) return hit
  try {
    const res = await fetch(`http://127.0.0.1:${card.port}/info`, {
      headers: { 'X-AgentPanel-Token': card.token },
      signal: AbortSignal.timeout(3000),
    })
    const body = (await res.json()) as { ok?: boolean; ops?: unknown }
    // 没有 ops 列表的是更旧的桥接，当不支持
    const yes = Array.isArray(body.ops) && body.ops.includes('assets.children')
    opsSeen.set(key, yes)
    return yes
  } catch {
    // 一时连不上（卡在断点、长帧）：这次走磁盘，不记，下次再问
    return false
  }
}

/** 桥接给的挂载根标上分组：项目插件看磁盘上的 .uplugin，其余不是 /Game 的都算引擎（引擎插件） */
async function tagRoots(root: string, folders: ChildFolder[]) {
  const mine = new Set((await projectPlugins(root)).map((m) => m.name.toLowerCase()))
  return folders
    .filter((f) => !NOT_CONTENT.has(f.path))
    .map((f) => ({
      ...f,
      root: f.root ?? (f.path === '/Game' ? 'game' : mine.has(f.path.slice(1).toLowerCase()) ? 'plugin' : 'engine'),
    })) as ChildFolder[]
}
