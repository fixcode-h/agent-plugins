import { BridgeError, liveCards, rpc, type Card } from './instances.ts'
import type { OpCtx } from './ops.ts'
import {
  CHILD_LIMIT,
  CHILD_MAX,
  diskChildren,
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

export async function assetChildren(ctx: OpCtx, args: Record<string, unknown>, timeoutMs = 30000): Promise<Children> {
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
