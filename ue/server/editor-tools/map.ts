import { runOp, type OpCtx } from '../ops.ts'
import { BridgeError, info, liveCards, rpc, type Card } from '../instances.ts'
import { withGrant } from '../confirm-grants.ts'
import type { Instance } from '../types.ts'
import { t } from '../util.ts'
import { markPieLog } from './pie-log.ts'

/**
 * ue_editor 的 open_map 和 pie_start（工具定义在 tools.ts）：做完、等到结果再返回（面板 ADR 0067 第 5 节）。
 * 起因（2026-11-25 碰杯玩法工作流）：Agent 用控制台 `open` 换图，编辑器世界里它立刻回成功、不等加载，
 * Agent 只能 sleep 后反复查状态、日志、截图；pie_start 也是马上返回，PIE 世界还没起来就去执行 Lua。
 * 这里把「停 PIE → 处理没保存的关卡改动 → 打开 → 等加载完」和「开 PIE → 等 PIE 世界起来」收在工具里。
 * 打开地图走 UELink 2.22 的 editor.map；桥接旧时退回控制台 open，同样等到地图换好或超时。
 */

interface MapStatus {
  package: string
  map: string
  pie?: boolean
  dirty?: string[]
  dirtyCount?: number
  loading?: boolean
  last?: { package: string; previous: string; ok?: boolean; ms?: number; error?: string }
}

type Unsaved = 'error' | 'save' | 'discard'

/** open_map 的结果（给 Agent，字段只在有值时出现） */
interface OpenResult {
  map: string
  package: string
  already?: boolean
  previous?: string
  ms?: number
  saved?: string[]
  discarded?: unknown
  note?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const clampMs = (v: unknown, def: number, max: number) => Math.min(Math.max(Number(v) || def, 1000), max)
const shortName = (pkg: string) => pkg.split('/').pop()?.split('.')[0] ?? pkg

async function editorCard(ctx: OpCtx): Promise<Card> {
  const card = (await liveCards(ctx.project.root)).find((c) => c.kind === 'editor')
  if (!card) throw new BridgeError('UE 编辑器没开：先 ue_editor action=start_editor，再 action=wait_ready 等它可用')
  return card
}

const pieWorlds = (inst: Instance) => inst.worlds.filter((w) => w.type === 'PIE')
const editorWorld = (inst: Instance) => inst.worlds.find((w) => w.type === 'Editor')

/** 反复看 /info 直到 ok 返回真或超时；编辑器加载中 /info 会超时，算还没好 */
async function waitInfo(card: Card, until: (i: Instance) => boolean, timeoutMs: number) {
  const end = Date.now() + timeoutMs
  let last: Instance | undefined
  while (Date.now() < end) {
    last = await info(card)
    if (last.online && until(last)) return { inst: last, ok: true }
    await sleep(500)
  }
  return { inst: last, ok: false }
}

const editorCtx = (ctx: OpCtx): OpCtx => ({ ...ctx, target: { instance: 'editor' } })

/** 停掉 PIE 并等它真的停下（打开地图前；PIE 里不能换编辑器的图） */
async function stopPie(ctx: OpCtx, card: Card) {
  await runOp(editorCtx(ctx), 'pie', { action: 'stop' })
  const r = await waitInfo(card, (i) => !pieWorlds(i).length, 30000)
  if (!r.ok) throw new BridgeError('PIE 30 秒内没停下来：去编辑器看一下是不是卡在弹窗或断点上')
}

/** 没保存的关卡改动：默认报错让 Agent 选；save 走 ue_save 同一条路（P4 先签出），discard 先弹卡问用户 */
async function handleDirty(
  ctx: OpCtx,
  st: MapStatus,
  unsaved: Unsaved,
): Promise<{ saved?: string[]; discard?: boolean }> {
  const dirty = st.dirty ?? []
  if (!dirty.length) return {}
  const list = dirty.slice(0, 10).join('、') + ((st.dirtyCount ?? dirty.length) > 10 ? ` 等 ${st.dirtyCount} 个` : '')
  if (unsaved === 'error')
    throw new BridgeError(
      `当前关卡 ${st.map} 有改了没保存的包（${list}）：这些可能是用户自己的改动。要保留就加 unsaved=save（先保存，P4 项目会签出）；确定不要就加 unsaved=discard（会请用户确认）；拿不准就先问用户`,
    )
  if (unsaved === 'save') {
    if ((st.dirtyCount ?? 0) > dirty.length)
      throw new BridgeError(`没保存的关卡包太多（${st.dirtyCount} 个）：请用户在编辑器里保存后再打开`)
    await runOp(editorCtx(ctx), 'asset.save', { packages: dirty })
    return { saved: dirty }
  }
  if (!ctx.confirm) throw new BridgeError('丢掉没保存的关卡改动要用户确认，但这次调用不在对话里，没法弹确认卡片')
  const r = await ctx.confirm(
    withGrant('map-discard', {
      title: t('换地图前丢掉关卡里没保存的改动'),
      detail: `${st.map}：${list}\n${t('丢掉后不能恢复。')}`,
    }),
  )
  if (!r.allow)
    throw new BridgeError(`用户没同意丢掉改动${r.message ? `（${r.message}）` : ''}：不要换地图，先问用户怎么处理`)
  return { discard: true }
}

/** UELink 2.22 起：editor.map 打开，再等 status 里的结果 */
async function openWithBridge(
  ctx: OpCtx,
  card: Card,
  a: Record<string, unknown>,
  timeoutMs: number,
): Promise<OpenResult> {
  const end = Date.now() + timeoutMs
  const st = (await rpc(card, 'editor.map', { action: 'status' })) as unknown as MapStatus
  const extra = await handleDirty(ctx, st, String(a.unsaved || 'error') as Unsaved)
  const r = await runOp(editorCtx(ctx), 'editor.map', {
    action: 'open',
    map: a.map,
    ...(extra.discard && { unsaved: 'discard' }),
    ...(a.reload === true && { reload: true }),
  })
  const pkg = String(r.package ?? '')
  const previous = String(r.previous ?? st.package)
  if (r.already) return { map: shortName(pkg), package: pkg, already: true }
  while (Date.now() < end) {
    // 加载期间编辑器主线程卡着，这个请求会等到加载完才回
    const now = (await rpc(card, 'editor.map', { action: 'status' }, Math.max(end - Date.now(), 1000)).catch(
      () => undefined,
    )) as unknown as MapStatus | undefined
    const last = now?.last
    if (last?.package === pkg && last.ok !== undefined) {
      if (!last.ok) throw new BridgeError(last.error || `没打开 ${pkg}`)
      return {
        map: shortName(pkg),
        package: pkg,
        previous,
        ms: last.ms,
        ...(extra.saved && { saved: extra.saved }),
        ...(r.discarded ? { discarded: r.discarded } : {}),
      }
    }
    await sleep(500)
  }
  throw new BridgeError(
    `${Math.round(timeoutMs / 1000)} 秒内 ${pkg} 还没打开完（大地图第一次加载、编译着色器会很久）：再调一次 open_map 同一个 map 接着等，不要用 sleep`,
  )
}

/** 旧 UELink（没有 editor.map）：控制台 open 换图，等编辑器世界的地图名变过去 */
async function openWithConsole(
  ctx: OpCtx,
  card: Card,
  a: Record<string, unknown>,
  timeoutMs: number,
): Promise<OpenResult> {
  const map = String(a.map ?? '').trim()
  if (!map.startsWith('/'))
    throw new BridgeError(
      `UE 里的 UELink 是 ${card.bridge}，按名字找地图要 2.22.0：先写全包名（/Game/...，用 ue_asset 搜 class=World 找），或到 UE 页「UE 插件」更新 UELink 后重新编译`,
    )
  const pkg = map.split('.')[0]
  const before = editorWorld(await info(card))?.map ?? ''
  if (before === shortName(pkg)) return { map: before, package: pkg, already: true }
  // 换图是这个动作本身要做的事，不再按「危险命令」弹卡；权限照「运行时」走
  await runOp({ ...editorCtx(ctx), internalConsole: true }, 'console', { command: `open ${pkg}`, world: 'editor' })
  const r = await waitInfo(card, (i) => editorWorld(i)?.map === shortName(pkg), timeoutMs)
  if (!r.ok)
    throw new BridgeError(
      `${Math.round(timeoutMs / 1000)} 秒内编辑器还停在 ${editorWorld(r.inst ?? ({ worlds: [] } as unknown as Instance))?.map || before}：可能弹了「保存改动」对话框等人点，请用户去编辑器看一下。UELink 更新到 2.22.0 后打开地图不弹框、能报出没保存的改动`,
    )
  return {
    map: shortName(pkg),
    package: pkg,
    previous: before,
    note: `UELink ${card.bridge} 没有 editor.map，用控制台 open 换的图，没检查没保存的关卡改动；更新到 2.22.0 更稳`,
  }
}

/** ue_editor action=open_map */
export async function openMap(ctx: OpCtx, a: Record<string, unknown>) {
  if (!String(a.map ?? '').trim())
    throw new BridgeError('要给 map：地图名（QuestMain_P_Free）、包名（/Game/Maps/...）或 .umap 文件路径')
  const unsaved = String(a.unsaved || 'error')
  if (!['error', 'save', 'discard'].includes(unsaved)) throw new BridgeError('unsaved 只能是 error、save 或 discard')
  const timeoutMs = clampMs(a.timeoutMs, 120000, 600000)
  const card = await editorCard(ctx)
  const inst = await info(card)
  if (!inst.online)
    throw new BridgeError(inst.error || `UE 编辑器（${card.pid}）没有回应：用 ue_editor action=wait_ready 等它可用`)
  let stoppedPie = false
  if (pieWorlds(inst).length) {
    await stopPie(ctx, card)
    stoppedPie = true
  }
  const r = inst.ops?.includes('editor.map')
    ? await openWithBridge(ctx, card, a, timeoutMs)
    : await openWithConsole(ctx, card, a, timeoutMs)
  return {
    ...r,
    ...(stoppedPie && { stoppedPie: true }),
    ...(!r.already && r.previous && { next: `测完要换回原来的地图：open_map map=${r.previous}` }),
  }
}

/**
 * PIE 开在哪：参数 window > GameTest 运行设置的 pieWindow（项目里一处改，Agent 开 PIE 和跑测试一致）> viewport。
 * 没装 GameTest 或读不到设置时按 viewport
 */
async function pieWindow(ctx: OpCtx, a: Record<string, unknown>) {
  if (a.window === 'new' || a.window === 'viewport') return a.window
  const r = (await runOp(editorCtx(ctx), 'gt.config', {}).catch(() => undefined)) as
    | { config?: { pieWindow?: string } }
    | undefined
  return r?.config?.pieWindow === 'new' ? 'new' : 'viewport'
}

/** ue_editor action=pie_start：开 PIE 并等 PIE 世界起来再返回，Agent 不用 sleep 再查 */
export async function startPie(ctx: OpCtx, a: Record<string, unknown>) {
  const card = await editorCard(ctx)
  const map = String(a.map ?? '').trim()
  // map：只在 PIE 里玩那张图（UELink 2.22 的 GlobalMapOverride），编辑器里的图和没保存的改动都不动
  if (map && !(await info(card)).ops?.includes('editor.map'))
    throw new BridgeError(
      `UE 里的 UELink 是 ${card.bridge}，pie_start 带 map 要 2.22.0：先 open_map 换图再 pie_start，或到 UE 页「UE 插件」更新 UELink 后重新编译`,
    )
  const logSince = await markPieLog(ctx, card.pid)
  const window = await pieWindow(ctx, a)
  const r = await runOp(editorCtx(ctx), 'pie', {
    action: 'start',
    players: a.players ?? 1,
    netMode: a.netMode ?? 'standalone',
    ...(map && { map }),
    // window：UELink 2.24 起认，默认 viewport（选中的视口，用户 2026-11-27 要跑测试不弹独立窗口）；旧版忽略，照旧开独立窗口
    ...(window === 'new' && { window }),
  })
  const want = Math.min(Math.max(Number(a.players) || 1, 1), 8)
  const w = await waitInfo(card, (i) => pieWorlds(i).length >= want, clampMs(a.timeoutMs, 60000, 300000))
  const worlds = w.inst ? pieWorlds(w.inst) : []
  const log =
    logSince !== undefined ? { logSince, logHint: '只看这次 PIE 之后的日志：ue_log action=tail pie=true' } : {}
  if (!w.ok)
    return {
      ...r,
      ...log,
      ready: false,
      note: worlds.length
        ? `PIE 起了 ${worlds.length} 个世界，还没到 ${want} 个：用 ue_status 看一下`
        : 'PIE 还没起来（可能在编译着色器或卡在弹窗）：用 ue_status 看 worlds，或 ue_log 看报错，不要 sleep 干等',
    }
  return {
    ...r,
    ...log,
    ready: true,
    worlds: worlds.map((x) => ({ id: x.id, map: x.map, netMode: x.netMode })),
    note: '游戏逻辑（主模块、Lua 环境）可能还在初始化：取不到对象时用 ue_log pie=true 看这次 PIE 有没有报错，别直接下结论；PIE 里出过错先 pie_stop 再重开，不要在坏掉的会话上接着查',
  }
}
