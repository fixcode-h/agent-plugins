import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { markBusy, markDown, markOnline } from './busy/state.ts'
import { checkReused, knownReused } from './editor-close/proc-start.ts'
import type { Instance, Target, World } from './types.ts'
import { bundledVersion, cmpVersion, pluginVersion } from './uelink.ts'
import { alive, readJson, t } from './util.ts'
import { rootOfCard, vsBreakNote } from './vs-debug/break-note.ts'

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
  /** 推送通道端口（只有编辑器进程有，UEKit docs/protocol.md 第 1、3 节） */
  stream?: number
  features?: string[]
  /** 这个进程里实际加载了的 UELink 扩展（AssetForge、GameTest） */
  extensions?: { name: string; version: string }[]
  /**
   * 编辑器可用了没有（UELink 2.7 起，UEKit docs/protocol.md 第 1 节）：主窗口建好、资源注册表扫完、没有异步加载。
   * 只有编辑器进程有这个字段；旧 UELink、后台编辑器、游戏进程没有，名片出现就算可用（用 cardReady 判断）
   */
  ready?: boolean
  readyAt?: string
}

/** 名片代表的进程能用了没有：没有 ready 字段（旧 UELink、非编辑器进程）时名片出现就算 */
export const cardReady = (card: Pick<Card, 'ready'>) => card.ready !== false

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
      // PID 被别的进程顶替了（UE 崩了没删名片、Windows 又把 PID 给了别人）：名片作废。
      // 第一次见到的名片在后台查，不拖慢这次读，查出来是顶替的下一次就清掉（editor-close/proc-start.ts）
      if (knownReused(card.pid, card.startedAt)) {
        await rm(path.join(dir, n), { force: true })
        continue
      }
      void checkReused(card.pid, card.startedAt)
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
    // UE 停在 VS 断点时整个进程冻住：直接说停在哪、先 continue，别让 Agent 以为卡死了去重启（vs-debug/break-note.ts）
    const paused = card.project ? await vsBreakNote(rootOfCard(card.project), card.project) : undefined
    if (paused) throw new BridgeError(paused)
    throw new BridgeError(
      // fetch failed：游戏线程卡住时排队的连接满了被拒绝，进程活着就和超时一样是在忙（见 info）
      err.name === 'TimeoutError' || err.message === 'fetch failed'
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
    'UE 进程 {pid} 里的 UELink（桥接）是 {old}，没有「{op}」这个操作（插件带的是 {new}）：到 UE 页「UE 插件」更新，重新编译并重启 UE。用不到新操作的功能照常能用',
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
    extensions: card.extensions,
    features: card.features,
    worlds: [],
  }
  try {
    const res = await fetch(`http://127.0.0.1:${card.port}/info`, {
      headers: { 'X-AgentPanel-Token': card.token },
      signal: AbortSignal.timeout(3000),
    })
    const body = (await res.json()) as Partial<Instance> & { ok?: boolean; error?: string }
    markOnline(card.pid, body.log)
    if (!body.ok) return { ...base, error: body.error || `HTTP ${res.status}` }
    return {
      ...base,
      online: true,
      ready: (body as { ready?: boolean }).ready ?? card.ready,
      log: body.log,
      worlds: (body.worlds ?? []).map(normWorld),
      lua: body.lua,
      extensions: body.extensions ?? card.extensions,
      ops: Array.isArray(body.ops) ? body.ops : undefined,
      batchOps: Array.isArray(body.batchOps) ? body.batchOps : undefined,
    }
  } catch (e) {
    const err = e as Error
    // 连上了却等不到回应：UELink 在游戏线程上回请求，游戏线程卡在同步加载里时就是这样（进程活着，liveCards 已经按 PID 筛过）。
    // 当成「忙」而不是断开，网页不提示再启动一个编辑器（用户 2026-11-16）
    // 连接直接失败（fetch failed：ECONNREFUSED / ECONNRESET）也一样：UE 的 HTTP 服务在游戏线程上接新连接，
    // 卡住时排队的连接满了 Windows 直接拒绝。进程还活着（liveCards 按 PID 筛过）就当忙，
    // 不判成连不上（用户 2026-11-17：启动卡在某处一会儿，目标卡显示「1 个进程连不上」「fetch failed」）
    if (err.name === 'TimeoutError' || err.name === 'AbortError' || err.message === 'fetch failed')
      return {
        ...base,
        busy: { since: markBusy(card.pid) },
        error: t('UE 进程 {pid} 暂时没有回应（可能在加载），忙完会自动连上', { pid: card.pid }),
      }
    markDown(card.pid)
    return { ...base, error: err.message }
  }
}

/**
 * 世界类型、网络模式统一成网页认的写法（Editor / PIE / Game，Standalone / ListenServer / Client / DedicatedServer）。
 * UELink 的 /info 一直回小写（editor / pie / game，standalone / listen / client / dedicated，UEKit docs/protocol.md），
 * 网页却按大写比，结果编辑器世界、PIE 世界在目标下拉里全显示成「游戏世界」，PIE 也认不出来（用户 2026-11-20 截图）。
 * 在这一处转，网页和假桥接（scripts/fake-bridge.mjs，本来就是大写）都不用改
 */
const WORLD_TYPES: Record<string, string> = { editor: 'Editor', pie: 'PIE', game: 'Game' }
const NET_MODES: Record<string, string> = {
  standalone: 'Standalone',
  listen: 'ListenServer',
  listenserver: 'ListenServer',
  client: 'Client',
  dedicated: 'DedicatedServer',
  dedicatedserver: 'DedicatedServer',
}
export function normWorld(w: World): World {
  return {
    ...w,
    type: WORLD_TYPES[String(w.type).toLowerCase()] ?? w.type,
    netMode: NET_MODES[String(w.netMode).toLowerCase()] ?? w.netMode,
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
