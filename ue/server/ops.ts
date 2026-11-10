import { ensureBackground } from './editor.ts'
import { record } from './history.ts'
import { BridgeError, liveCards, pickCard, rpc, type Card } from './instances.ts'
import type { PluginConfirm } from '../../sdk/server.ts'
import type { Actor, HistoryItem, Target, UeProject } from './types.ts'
import { c, run, t, wildcard } from './util.ts'

/**
 * 所有对 UE 的操作都走这里（网页和 Agent 工具共用）：选目标进程、按权限放行或请你确认、危险命令确认、
 * 资源操作在编辑器没开时转给后台编辑器、写操作记进操作记录（设计文档 3.1、3.4、6）。
 */
export interface OpCtx {
  project: UeProject
  actor: Actor
  /** Agent 调用时：对话里的「允许 / 拒绝」卡片（面板插件接口 2） */
  confirm?: (req: PluginConfirm) => Promise<{ allow: boolean; message: string }>
  target?: Target
  /** 网页上你已经在弹窗里确认过危险命令 */
  confirmed?: boolean
}

type Kind = 'read' | 'runtime' | 'asset' | 'save'

/** 运行时对象的路径：关卡里的 Actor、PIE 世界、临时包；其余以 / 开头的当资源 */
export function isRuntimePath(p: string) {
  return !p.startsWith('/') || /:PersistentLevel|UEDPIE_|^\/Temp\/|^\/Engine\/Transient/i.test(p)
}

const ASSET_OPS = new Set([
  'assets',
  'datatable',
  'datatable.row',
  'datatable.set',
  'datatable.rows',
  'asset.dirty',
  'asset.save',
  'asset.revert',
])
const PATH_OPS = new Set(['props', 'get', 'functions', 'set', 'call', 'umg.tree'])

function kindOf(op: string, args: Record<string, unknown>): Kind {
  switch (op) {
    case 'console':
    case 'cvar.set':
    case 'gm.run':
    case 'call':
    case 'log.clear':
    case 'livecoding':
      return 'runtime'
    case 'pie':
      return args.action === 'start' || args.action === 'stop' ? 'runtime' : 'read'
    case 'set':
      return isRuntimePath(String(args.path ?? '')) ? 'runtime' : 'asset'
    case 'datatable.set':
    case 'datatable.rows':
    case 'asset.revert':
      return 'asset'
    case 'asset.save':
      return 'save'
    default:
      return 'read'
  }
}

/** 这一步要不要走资源（编辑器没开时转给后台编辑器） */
function wantsAssets(op: string, args: Record<string, unknown>) {
  if (ASSET_OPS.has(op)) return true
  return PATH_OPS.has(op) && !isRuntimePath(String(args.path ?? ''))
}

export const DEFAULT_DANGEROUS =
  'quit, exit, exitnow, debug crash*, debug assert*, debug gpf*, debug ensure*, open *, servertravel *, travel *, restartlevel, disconnect, obj gc*'

export function dangerousMatch(command: string) {
  const list = String(c().config().dangerous || DEFAULT_DANGEROUS)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return list.find((p) => wildcard(p, command) || wildcard(p, command.split(/\s+/)[0]))
}

async function ask(ctx: OpCtx, req: PluginConfirm) {
  if (!ctx.confirm) throw new BridgeError(t('这一步要你确认，但这次调用不在对话里，没法弹出确认卡片'))
  const r = await ctx.confirm(req)
  if (!r.allow) throw new BridgeError(t('你拒绝了：{msg}', { msg: r.message || req.title }))
}

function describe(op: string, args: Record<string, unknown>) {
  const v = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x))
  switch (op) {
    case 'console':
      return String(args.command ?? '')
    case 'cvar.set':
      return `${args.name} = ${v(args.value)}`
    case 'gm.run':
      return `${args.name} ${((args.args as unknown[]) ?? []).map(v).join(' ')}`.trim()
    case 'set':
      return `${args.path} · ${args.prop} = ${v(args.value)}`
    case 'call':
      return `${args.path} · ${args.function}(${v(args.args ?? [])})`
    case 'datatable.set':
      return `${args.path} · ${args.row}.${args.column} = ${v(args.value)}`
    case 'datatable.rows':
      return `${args.path} · ${args.action} ${args.row}${args.to ? ` → ${args.to}` : ''}`
    case 'asset.save':
    case 'asset.revert':
      return ((args.packages as string[]) ?? []).join('\n')
    case 'pie':
      return `PIE ${args.action}${args.players ? ` × ${args.players}` : ''}${args.netMode ? ` ${args.netMode}` : ''}`
    default:
      return op
  }
}

/** Agent 的权限（设计文档 6）：你在网页上的操作不受这个限制 */
async function checkPerms(ctx: OpCtx, op: string, kind: Kind, args: Record<string, unknown>) {
  if (ctx.actor.kind !== 'agent') return
  const { runtime, asset } = ctx.project.perms
  const what = describe(op, args)
  if (kind === 'runtime') {
    if (runtime === 'read')
      throw new BridgeError(t('UE 页「桥接与权限」里 Agent 对运行时是只读，不能执行：{what}', { what }))
    if (runtime === 'ask') await ask(ctx, { title: t('Agent 要改正在运行的 UE'), detail: what })
  } else if (kind === 'asset') {
    if (asset === 'read')
      throw new BridgeError(t('UE 页「桥接与权限」里 Agent 对资源是只读，不能修改：{what}', { what }))
  } else if (kind === 'save') {
    if (asset === 'read') throw new BridgeError(t('UE 页「桥接与权限」里 Agent 对资源是只读，不能保存'))
    if (asset === 'ask')
      await ask(ctx, {
        title: t('Agent 要保存 UE 资源（P4 项目会先签出）'),
        detail: what,
      })
  }
}

async function chooseCard(ctx: OpCtx, op: string, args: Record<string, unknown>): Promise<Card> {
  const cards = await liveCards(ctx.project.root)
  const target = ctx.target ?? { instance: ctx.project.target.kind || undefined }
  const assets = wantsAssets(op, args)
  // 运行时操作只发给有游戏世界的进程；资源操作谁都行，编辑器没开时起后台编辑器
  const live = cards.filter((x) => x.kind !== 'background')
  if (assets && !live.length && !(ctx.target?.instance && ctx.target.instance !== 'background')) {
    if (c().config().offline === 'off') throw new BridgeError(t('UE 没在运行，插件参数里关掉了离线读取（后台编辑器）'))
    return cards.find((x) => x.kind === 'background') ?? (await ensureBackground(ctx.project))
  }
  const card = pickCard(cards, target.instance ? target : undefined, 'editor', !assets)
  if (!card)
    throw new BridgeError(
      assets
        ? t('没有可用的 UE 进程')
        : t('UE 没在运行（或没装桥接插件）：先启动编辑器 / 游戏，运行时操作才有对象可操作'),
    )
  return card
}

/** P4 项目保存前签出（进默认变更列表，不提交）；git / svn 不用签出 */
async function checkout(p: UeProject, card: Card, packages: string[]) {
  if (p.vcs !== 'p4') return
  const dirty = (await rpc(card, 'asset.dirty', {})) as {
    items?: { package: string; file: string; readOnly: boolean }[]
  }
  const files = (dirty.items ?? []).filter((i) => packages.includes(i.package) && i.readOnly).map((i) => i.file)
  if (!files.length) return
  const r = await run('p4', ['-d', p.root, 'edit', '-c', 'default', ...files], { cwd: p.root, timeout: 60000 })
  if (r.code !== 0) throw new BridgeError(t('P4 签出失败：{msg}', { msg: (r.err || r.out).trim() }))
}

function undoOf(op: string, args: Record<string, unknown>, res: Record<string, unknown>, world: string) {
  if (op === 'set' && isRuntimePath(String(args.path)))
    return { undo: { op: 'set', args: { path: args.path, prop: args.prop, value: res.prev, world } } }
  if (op === 'cvar.set') return { undo: { op: 'cvar.set', args: { name: args.name, value: res.prev } } }
  if (op === 'log.clear') return { noUndo: t('清空日志不能撤回') }
  if (kindOf(op, args) === 'asset') return { noUndo: t('资源改动用「放弃改动」撤回') }
  if (op === 'asset.save') return { noUndo: t('已经写回磁盘') }
  return { noUndo: t('命令、GM 和函数调用不能自动撤回') }
}

export async function runOp(
  ctx: OpCtx,
  op: string,
  rawArgs: Record<string, unknown> = {},
  timeoutMs = 30000,
): Promise<Record<string, unknown>> {
  const args = { ...rawArgs }
  const kind = kindOf(op, args)
  if (op === 'console') {
    const cmd = String(args.command ?? '').trim()
    const hit = dangerousMatch(cmd)
    if (hit && !(ctx.actor.kind === 'user' && ctx.confirmed)) {
      if (ctx.actor.kind === 'user')
        throw new BridgeError(t('「{cmd}」是危险命令（{rule}），要先确认', { cmd, rule: hit }))
      await ask(ctx, { title: t('Agent 要执行危险命令'), detail: `${cmd}\n${t('匹配规则：{rule}', { rule: hit })}` })
    }
  }
  await checkPerms(ctx, op, kind, args)
  const card = await chooseCard(ctx, op, args)
  const world = String(args.world ?? ctx.target?.world ?? (ctx.target ? '' : ctx.project.target.world) ?? '')
  if (world && !args.world) args.world = world
  if (op === 'asset.save') await checkout(ctx.project, card, (args.packages as string[]) ?? [])

  if (kind === 'read') {
    const res = await rpc(card, op, args, timeoutMs)
    return { ...res, instance: { pid: card.pid, kind: card.kind } }
  }
  const base: Omit<HistoryItem, 'id' | 'at' | 'ok' | 'summary'> = {
    actor: ctx.actor,
    pid: card.pid,
    instanceKind: card.kind,
    world,
    op,
  }
  try {
    const res = await rpc(card, op, args, timeoutMs)
    const item = await record(ctx.project.id, {
      ...base,
      summary: describe(op, args),
      prev: res.prev,
      value: res.value ?? args.value,
      ok: true,
      ...undoOf(op, args, res, String(res.world ?? world)),
    })
    return { ...res, instance: { pid: card.pid, kind: card.kind }, history: item.id }
  } catch (e) {
    await record(ctx.project.id, { ...base, summary: describe(op, args), ok: false, error: (e as Error).message })
    throw e
  }
}
