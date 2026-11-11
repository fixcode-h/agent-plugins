import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assetQuery } from './asset-query.ts'
import { ensureBackground } from './editor.ts'
import { record } from './history.ts'
import { BridgeError, liveCards, pickCard, rpc, type Card } from './instances.ts'
import type { PluginConfirm } from '../../sdk/server.ts'
import { formatLuaPath, type LuaKey } from './luapath.ts'
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

/**
 * read 只读；runtime 改正在运行的 UE；asset 改资源内容（含蓝图图表）；save 写回磁盘；
 * struct 结构性操作（新建、复制、改名 / 移动）；delete 删除资源（每次确认）；python 执行 Python（每次确认）
 */
type Kind = 'read' | 'runtime' | 'asset' | 'save' | 'struct' | 'delete' | 'python'

/** 运行时对象的路径：关卡里的 Actor、PIE 世界、临时包；其余以 / 开头的当资源 */
export function isRuntimePath(p: string) {
  return !p.startsWith('/') || /:PersistentLevel|UEDPIE_|^\/Temp\/|^\/Engine\/Transient/i.test(p)
}

const ASSET_OPS = new Set([
  'assets',
  'asset.classes',
  'datatable',
  'datatable.row',
  'datatable.set',
  'datatable.rows',
  'asset.dirty',
  'asset.save',
  'asset.revert',
  'asset.describe',
  'asset.export',
  'asset.textify',
  'asset.refs',
  'asset.validate',
  'asset.create',
  'asset.duplicate',
  'asset.rename',
  'asset.delete',
  'asset.undo',
  'bp.outline',
  'bp.graph',
  'bp.find',
  'bp.node_search',
  'bp.edit',
  'bp.compile',
  'python',
])
const PATH_OPS = new Set(['props', 'get', 'functions', 'set', 'call', 'umg.tree', 'object.refs'])

function kindOf(op: string, args: Record<string, unknown>): Kind {
  switch (op) {
    case 'console':
    case 'cvar.set':
    case 'gm.run':
    case 'call':
    case 'log.clear':
    case 'livecoding':
    case 'lua.set':
    case 'lua.exec':
      return 'runtime'
    case 'pie':
      return args.action === 'start' || args.action === 'stop' ? 'runtime' : 'read'
    case 'set':
      return isRuntimePath(String(args.path ?? '')) ? 'runtime' : 'asset'
    case 'datatable.set':
    case 'datatable.rows':
    case 'asset.revert':
    case 'asset.undo':
    case 'bp.edit':
    case 'bp.compile':
      return 'asset'
    case 'asset.create':
    case 'asset.duplicate':
    case 'asset.rename':
      // 演练只检查能不能做，不留改动
      return args.dryRun ? 'read' : 'struct'
    case 'asset.delete':
      return args.dryRun ? 'read' : 'delete'
    case 'python':
      return 'python'
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
      if (args.array)
        return `${args.path} · ${args.prop} ${args.array}${args.index !== undefined ? ` [${args.index}]` : ''}`
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
    case 'asset.create':
      return `${t('新建')} ${args.class ?? 'Blueprint'} · ${args.path}${args.parent ? ` · ${t('父类')} ${args.parent}` : ''}${args.rowStruct ? ` · ${args.rowStruct}` : ''}`
    case 'asset.duplicate':
      return `${t('复制')} ${args.path} → ${args.to}`
    case 'asset.rename':
      return `${t('改名 / 移动')} ${args.path} → ${args.to}`
    case 'asset.delete':
      return `${t('删除')} ${args.path}${args.force ? ` · ${t('强删（引用它的资源会断开）')}` : ''}`
    case 'asset.undo':
      return `${t('撤回')} ${args.path ?? ''} · ${args.tx}`
    case 'bp.edit':
      return `${args.path}${args.dryRun ? ` · ${t('演练')}` : ''}\n${describeOps(args.ops)}`
    case 'bp.compile':
      return `${t('编译')} ${args.path}`
    case 'python':
      return String(args.code ?? '')
    case 'lua.set':
      return `${args.path || '_G'} · ${formatLuaPath((args.keys as LuaKey[]) ?? [])} = ${v(args.value ?? null)}`
    case 'lua.exec':
      return `${args.path ? `self = ${args.path}\n` : ''}${String(args.code ?? '')}`
    case 'pie':
      return `PIE ${args.action}${args.players ? ` × ${args.players}` : ''}${args.netMode ? ` ${args.netMode}` : ''}`
    default:
      return op
  }
}

/** 蓝图操作列表的摘要：一行一个操作，记进操作记录、显示在确认卡片上 */
function describeOps(ops: unknown) {
  if (!Array.isArray(ops)) return ''
  const one = (o: Record<string, unknown>) => {
    const rest = Object.entries(o)
      .filter(([k]) => k !== 'op')
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ')
    return `${o.op} ${rest}`.trim().slice(0, 200)
  }
  const lines = ops.slice(0, 40).map((o) => one((o ?? {}) as Record<string, unknown>))
  if (ops.length > 40) lines.push(`… ${ops.length - 40}`)
  return lines.join('\n')
}

/**
 * 哪个对话改了哪个包、还没保存（键：项目 id + 包名）。多个子对话同时改同一个资源会在编辑器里互相覆盖，
 * 所以另一个对话改过、还没保存的包，后来的对话改它时直接报错，让它们自己协调（不排队：资源编辑很快，报错比等待好查）
 */
const owners = new Map<string, string>()
const ownerKey = (p: UeProject, pkg: string) => `${p.id}|${pkg}`
const packageOf = (assetPath: unknown) => String(assetPath ?? '').split('.')[0]

async function claim(ctx: OpCtx, card: Card, pkg: string) {
  if (ctx.actor.kind !== 'agent' || !pkg.startsWith('/')) return
  const key = ownerKey(ctx.project, pkg)
  const other = owners.get(key)
  if (other && other !== ctx.actor.taskId) {
    const dirty = (await rpc(card, 'asset.dirty', {})) as { items?: { package: string }[] }
    if ((dirty.items ?? []).some((i) => i.package === pkg))
      throw new BridgeError(t('{pkg} 正被另一个对话修改、还没保存。等它保存或放弃改动后再改，不要绕过去', { pkg }))
  }
  owners.set(key, ctx.actor.taskId)
}

function release(p: UeProject, packages: string[]) {
  for (const pkg of packages) owners.delete(ownerKey(p, pkg))
}

/** Agent 的权限（设计文档 6）：你在网页上的操作不受这个限制 */
async function checkPerms(ctx: OpCtx, op: string, kind: Kind, args: Record<string, unknown>) {
  if (ctx.actor.kind !== 'agent') return
  const { runtime, asset, struct, python } = ctx.project.perms
  const what = describe(op, args)
  if (kind === 'runtime') {
    if (runtime === 'read')
      throw new BridgeError(t('UE 页「桥接与权限」里 Agent 对运行时是只读，不能执行：{what}', { what }))
    // 任意 Lua 代码能做的事没有边界：不管权限设成什么，Agent 每次执行都先请你确认（用户 2026-11-10 定）
    if (op === 'lua.exec') await ask(ctx, { title: t('Agent 要在 UE 里执行 Lua 代码'), detail: what })
    else if (runtime === 'ask') await ask(ctx, { title: t('Agent 要改正在运行的 UE'), detail: what })
  } else if (kind === 'asset') {
    if (asset === 'read')
      throw new BridgeError(t('UE 页「桥接与权限」里 Agent 对资源是只读，不能修改：{what}', { what }))
  } else if (kind === 'struct') {
    if (struct === 'read')
      throw new BridgeError(
        t('UE 页「桥接与权限」里没有允许 Agent 做结构性操作（新建、复制、改名），不能执行：{what}', { what }),
      )
    if (struct === 'ask') await ask(ctx, { title: t('Agent 要新建 / 复制 / 改名 UE 资源'), detail: what })
  } else if (kind === 'delete') {
    if (struct === 'read')
      throw new BridgeError(t('UE 页「桥接与权限」里没有允许 Agent 做结构性操作，不能删除：{what}', { what }))
    // 删除不管权限设成什么，每次都确认
    await ask(ctx, { title: t('Agent 要删除 UE 资源'), detail: what })
  } else if (kind === 'python') {
    if (!python)
      throw new BridgeError(t('UE 页「桥接与权限」里没有打开「执行 Python」，Agent 不能在编辑器里执行 Python'))
    // 任意 Python 能做的事没有边界：和 Lua 一样每次都确认
    await ask(ctx, { title: t('Agent 要在 UE 编辑器里执行 Python'), detail: what })
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
async function checkout(p: UeProject, card: Card, packages: string[]): Promise<string[]> {
  if (p.vcs !== 'p4') return []
  const dirty = (await rpc(card, 'asset.dirty', {})) as {
    items?: { package: string; file: string; readOnly: boolean; isNew?: boolean }[]
  }
  const mine = (dirty.items ?? []).filter((i) => !packages.length || packages.includes(i.package))
  const files = mine.filter((i) => i.readOnly).map((i) => i.file)
  // 还没存过盘的新资源：保存后 p4 add
  const added = mine.filter((i) => i.isNew).map((i) => i.file)
  if (!files.length) return added
  const r = await run('p4', ['-d', p.root, 'edit', '-c', 'default', ...files], { cwd: p.root, timeout: 60000 })
  if (r.code !== 0) throw new BridgeError(t('P4 签出失败：{msg}', { msg: (r.err || r.out).trim() }))
  return added
}

/** P4 项目里新建和删除的文件也进默认变更列表（不提交）。失败不抛：引擎里的操作已经做完，把 P4 的报错放进结果原样给出 */
async function p4After(p: UeProject, verb: 'add' | 'delete', files: string[], keep = false) {
  if (p.vcs !== 'p4' || !files.length) return undefined
  const args = ['-d', p.root, verb, ...(keep ? ['-k'] : []), '-c', 'default', ...files]
  const r = await run('p4', args, { cwd: p.root, timeout: 60000 })
  return r.code === 0 ? { ok: true, verb, files } : { ok: false, verb, files, error: (r.err || r.out).trim() }
}

function undoOf(op: string, args: Record<string, unknown>, res: Record<string, unknown>, world: string) {
  if (op === 'set' && isRuntimePath(String(args.path)))
    return { undo: { op: 'set', args: { path: args.path, prop: args.prop, value: res.prev, world } } }
  if (op === 'lua.set')
    return { undo: { op: 'lua.set', args: { path: args.path, keys: args.keys, value: res.prev ?? null, world } } }
  if (op === 'lua.exec') return { noUndo: t('执行的 Lua 代码不能自动撤回') }
  if (op === 'cvar.set') return { undo: { op: 'cvar.set', args: { name: args.name, value: res.prev } } }
  if (op === 'log.clear') return { noUndo: t('清空日志不能撤回') }
  // 包在编辑器事务里的资源修改：按事务 id 撤同一步（之后编辑器里又有别的修改时桥接会拒绝）
  if (typeof res.tx === 'string' && res.tx && op !== 'asset.undo')
    return { undo: { op: 'asset.undo', args: { tx: res.tx, path: args.path } } }
  if (op === 'python') return { noUndo: t('执行的 Python 代码不能自动撤回') }
  if (['struct', 'delete'].includes(kindOf(op, args)))
    return { noUndo: t('新建、复制、改名、删除不能自动撤回：没保存前用「放弃改动」，或反向再做一次') }
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
  // 非蓝图函数（受保护、私有、没标 BlueprintCallable）只让网页上你自己点的执行；Agent 的 ue_call 只能调蓝图开放的（用户 2026-11-11 定）
  if (op === 'call' && args.any && ctx.actor.kind !== 'user')
    throw new BridgeError(t('Agent 只能调用蓝图开放的函数（BlueprintCallable、Exec 或标了 AgentPanel 的）'))
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
  const added = op === 'asset.save' ? await checkout(ctx.project, card, (args.packages as string[]) ?? []) : []
  if (kind === 'asset' && op !== 'asset.revert' && op !== 'asset.undo') await claim(ctx, card, packageOf(args.path))

  if (op === 'assets') return searchAssets(ctx, card, args, timeoutMs)
  // 蓝图演练：真实执行后桥接自己取消，不留改动，也不进操作记录
  if (kind === 'read' || (op === 'bp.edit' && args.dryRun)) {
    const res = await rpc(card, op, args, timeoutMs)
    return { ...res, instance: { pid: card.pid, kind: card.kind } }
  }
  const base: Omit<HistoryItem, 'id' | 'at' | 'ok' | 'summary'> = {
    actor: ctx.actor,
    pid: card.pid,
    instanceKind: card.kind,
    // 资源不属于哪个世界：不带世界，PIE 停了也还能撤回
    world: kind === 'runtime' ? world : '',
    op,
  }
  try {
    const res =
      op === 'python'
        ? await python(ctx.project, card, String(args.code ?? ''), timeoutMs)
        : await rpc(card, op, args, timeoutMs)
    if (op === 'asset.save') res.vcs = await p4After(ctx.project, 'add', added)
    if (op === 'asset.delete' && res.onDisk)
      res.vcs = await p4After(ctx.project, 'delete', [String(res.file)], !!res.fileRemoved)
    if (op === 'asset.save' || op === 'asset.revert') release(ctx.project, (args.packages as string[]) ?? [])
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

/** 资源搜索：前缀框里贴的磁盘路径、/Game 路径先拆成目录 + 名字（见 asset-query.ts），结果里带上实际搜的位置 */
async function searchAssets(ctx: OpCtx, card: Card, args: Record<string, unknown>, timeoutMs: number) {
  const q = assetQuery(ctx.project, args.prefix, args.path)
  let searched = { path: q.path, prefix: q.prefix }
  let res = await rpc(card, 'assets', { ...args, ...searched }, timeoutMs)
  if (q.fallback && !Number(res.total)) {
    searched = q.fallback
    res = await rpc(card, 'assets', { ...args, ...searched }, timeoutMs)
  }
  return { ...res, searched, instance: { pid: card.pid, kind: card.kind } }
}

/**
 * 在编辑器里执行 Python：代码写成临时文件，用控制台的 py 命令执行（项目要启用引擎自带的 Python Editor Script Plugin），
 * 输出是执行期间的日志（print 进 LogPython）。不给桥接加 Python 模块依赖：没启用这个插件的项目照样能编译桥接
 */
async function python(p: UeProject, card: Card, code: string, timeoutMs: number) {
  if (!code.trim()) throw new BridgeError(t('没有给 Python 代码'))
  const dir = path.join(p.root, 'Saved', 'AgentPanel', 'py')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `run-${Date.now()}.py`)
  await writeFile(file, code, 'utf8')
  try {
    // 控制台命令里路径用正斜杠：反斜杠加引号在 UE 的命令行解析里会被当成转义
    const res = await rpc(card, 'console', { command: `py "${file.replaceAll('\\', '/')}"` }, timeoutMs)
    const output = (res.output as string[]) ?? []
    if (output.some((l) => /command not recognized|unknown command/i.test(l) && /\bpy\b/i.test(l)))
      throw new BridgeError(
        t('编辑器不认识 py 命令：项目没有启用 Python Editor Script Plugin（编辑 → 插件里打开后重启编辑器）'),
      )
    return { output } as Record<string, unknown>
  } finally {
    await rm(file, { force: true })
  }
}
