import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { Instance, Target } from './types.ts'
import { bundledVersion, cmpVersion, pluginVersion } from './uelink.ts'
import { alive, readJson, t } from './util.ts'

/**
 * 实例发现（设计文档 2.1）：UELink 起服务后在 <项目>/Saved/UELink/instances/<PID>.json 写名片
 * （端口、令牌、进程类型），退出时删掉；进程崩了名片会留下，这里按 PID 是否还活着清掉。
 * 还没升级的旧桥接（AgentPanelBridge 1.x）写在 Saved/AgentPanel/instances/，两处都读，同一个进程只算一次。
 */
export interface Card {
  pid: number
  port: number
  token: string
  kind: string
  engine: string
  bridge: string
  project: string
  startedAt: string
}

const cardDirs = (root: string) => [
  path.join(root, 'Saved', 'UELink', 'instances'),
  path.join(root, 'Saved', 'AgentPanel', 'instances'),
]

export async function liveCards(root: string): Promise<Card[]> {
  const out: Card[] = []
  const seen = new Set<number>()
  for (const dir of cardDirs(root)) {
    for (const n of await readdir(dir).catch(() => [] as string[])) {
      if (!n.endsWith('.json')) continue
      const card = await readJson<Card | null>(path.join(dir, n), null)
      if (!card?.pid || !card.port) continue
      if (!alive(card.pid)) {
        await rm(path.join(dir, n), { force: true })
        continue
      }
      if (seen.has(card.pid)) continue
      seen.add(card.pid)
      out.push(card)
    }
  }
  return out.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.pid - b.pid)
}

/** 默认目标的优先级：编辑器 > 游戏 > 专用服务器 > 后台编辑器 */
const kindRank = (k: string) => ['editor', 'game', 'server', 'background'].indexOf(k) + 1 || 9

/**
 * 项目里装的桥接版本：Plugins/UELink/UELink.uplugin 的 VersionName；没有时看旧桥接 Plugins/AgentPanelBridge（1.x），
 * 这样旧项目照样显示「已安装 1.9.0、可升级到 2.x」，升级时安装会把旧的清掉
 */
export async function bridgeVersionIn(root: string) {
  return (
    (await pluginVersion(path.join(root, 'Plugins', 'UELink', 'UELink.uplugin'))) ||
    (await pluginVersion(path.join(root, 'Plugins', 'AgentPanelBridge', 'AgentPanelBridge.uplugin')))
  )
}

export class BridgeError extends Error {}

/** 调桥接：POST /rpc，出错原样抛（面板硬规则：错误显示给用户，不悄悄重试） */
export async function rpc(card: Card, op: string, args: Record<string, unknown> = {}, timeoutMs = 30000) {
  let res: Response
  try {
    res = await fetch(`http://127.0.0.1:${card.port}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AgentPanel-Token': card.token },
      body: JSON.stringify({ op, args }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    const err = e as Error
    throw new BridgeError(
      err.name === 'TimeoutError'
        ? t('UE 进程 {pid} 在 {s} 秒内没有回应（可能卡在断点、加载或长帧里）', { pid: card.pid, s: timeoutMs / 1000 })
        : t('连不上 UE 进程 {pid} 的桥接（端口 {port}）：{msg}', { pid: card.pid, port: card.port, msg: err.message }),
    )
  }
  const body = (await res.json().catch(() => null)) as
    | ({ ok?: boolean; error?: string } & Record<string, unknown>)
    | null
  if (!body) throw new BridgeError(t('桥接回了无法解析的内容（HTTP {code}）', { code: res.status }))
  if (!body.ok)
    throw new BridgeError(
      (await oldBridgeError(card, op, body.error)) ||
        body.error ||
        t('桥接返回失败（HTTP {code}）', { code: res.status }),
    )
  return body
}

/** a 比 b 旧（按语义化版本比，2.0.0-beta.1 比 2.0.0 旧） */
export function olderVersion(a: string, b: string) {
  return cmpVersion(a, b) < 0
}

/**
 * 桥接没有这个操作、而且它比插件带的旧：按能力降级（插件框架改进 C1）。插件新版本只有用到新操作的功能要新桥接，
 * 其余在旧桥接上照常用；用到时统一说清楚是桥接旧了、怎么更新，不再每个功能各写一遍「旧桥接」的提示。
 * 同样的报错在游戏进程里也会出现（编辑器专用的操作），那种桥接不旧，原样报
 */
async function oldBridgeError(card: Card, op: string, error?: string) {
  if (!error?.startsWith(`这个进程不支持 ${op}`) || !card.bridge) return ''
  const bundled = await bundledVersion()
  if (!bundled || !olderVersion(card.bridge, bundled)) return ''
  return t(
    'UE 进程 {pid} 里的 UELink（桥接）是 {old}，没有「{op}」这个操作（插件带的是 {new}）：到 UE 页「桥接与权限」更新，重新编译并重启 UE。用不到新操作的功能照常能用',
    { pid: card.pid, old: card.bridge, op, new: bundled },
  )
}

export async function info(card: Card): Promise<Instance> {
  const base: Instance = {
    pid: card.pid,
    port: card.port,
    kind: card.kind,
    engine: card.engine,
    bridge: card.bridge,
    startedAt: card.startedAt,
    online: false,
    worlds: [],
  }
  try {
    const res = await fetch(`http://127.0.0.1:${card.port}/info`, {
      headers: { 'X-AgentPanel-Token': card.token },
      signal: AbortSignal.timeout(3000),
    })
    const body = (await res.json()) as Partial<Instance> & { ok?: boolean; error?: string }
    if (!body.ok) return { ...base, error: body.error || `HTTP ${res.status}` }
    return { ...base, online: true, log: body.log, worlds: body.worlds ?? [], lua: body.lua }
  } catch (e) {
    return { ...base, error: (e as Error).message }
  }
}

export async function instances(root: string): Promise<Instance[]> {
  return Promise.all((await liveCards(root)).map(info))
}

/**
 * 选目标进程：target.instance 写了 PID 或类型就按它；没写用网页上选的；都没有按优先级取第一个。
 * excludeBackground：运行时操作不发给后台编辑器（它没有游戏世界）
 */
export function pickCard(cards: Card[], target: Target | undefined, fallbackKind: string, excludeBackground = false) {
  const list = excludeBackground ? cards.filter((c) => c.kind !== 'background') : cards
  const want = target?.instance
  if (want !== undefined && want !== '') {
    const n = typeof want === 'number' ? want : /^\d+$/.test(want) ? parseInt(want, 10) : NaN
    const hit = Number.isFinite(n) ? list.find((c) => c.pid === n) : list.find((c) => c.kind === want)
    if (!hit)
      throw new BridgeError(
        t('没有找到目标实例 {want}（在运行的：{list}）', {
          want: String(want),
          list: cards.map((c) => `${c.kind} ${c.pid}`).join('、') || t('无'),
        }),
      )
    return hit
  }
  return list.find((c) => c.kind === fallbackKind) ?? list[0]
}
