import { offlineClasses } from './uekit/gt-ref/offline/classes.ts'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assetChildren } from './asset-folders.ts'
import { assetQuery } from './asset-query.ts'
import { newlyDirty, pythonTxId, pythonWrapper } from './python-run.ts'
import { autoBackground, ensureBackground, noBackgroundMsg } from './editor.ts'
import { record } from './history.ts'
import { BridgeError, liveCards, pickCard, rpc, type Card } from './instances.ts'
import type { PluginConfirm } from '../../sdk/server.ts'
import { formatLuaPath, type LuaKey } from './luapath.ts'
import { isBatchArgs, keepJob, runAsJob } from './long-ops.ts'
import { batchUndo, itemPaths } from './batch/undo.ts'
import { followJob } from './uekit/follow.ts'
import { FORGE_DISK_OPS, forgeFromDisk } from './uekit/forge-disk.ts'
import { GT_DISK_OPS, gtFromDisk } from './uekit/gt-disk.ts'
import { GT_REF_OPS, gtRefOp } from './uekit/gt-ref/ops.ts'
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
  /** 你批准过的 Lua 片段的代码（lua-debug/snippets.ts）：Agent 执行它时不再逐次确认 */
  approvedLua?: string
}

/**
 * read 只读；runtime 改正在运行的 UE；asset 改资源内容（含蓝图图表）；save 写回磁盘；
 * struct 结构性操作（新建、复制、改名 / 移动）；delete 删除资源（跟结构性操作同一档）；python 执行 Python（按 Python 权限）
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
  'asset.snapshot',
  'asset.refs',
  'asset.validate',
  'asset.create',
  'asset.duplicate',
  'asset.rename',
  'asset.delete',
  'asset.undo',
  // UELink 2.16：导入外部文件、重新导入、编辑器函数库
  'asset.import',
  'asset.reimport',
  'editor.functions',
  'editor.call',
  'bp.outline',
  'bp.graph',
  'bp.find',
  'bp.node_search',
  'bp.edit',
  'bp.compile',
  'python',
  // 编辑器小工具：重定向器、Tag 的引用方都只有资源注册表知道，编辑器没开时后台编辑器也能做
  'asset.redirectors',
  'tags.refs',
  // AssetForge（UEKit 扩展）：读配置和资产，编辑器没开时后台编辑器也能做
  'forge.health',
  'forge.kinds',
  'forge.entries',
  'forge.describe',
  'forge.plan',
  'forge.diff',
  'forge.import',
  'forge.export',
  'forge.job',
  'forge.stop',
])
const PATH_OPS = new Set(['props', 'get', 'functions', 'set', 'call', 'umg.tree', 'object.refs', 'components'])

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
    case 'lua.gm':
    // 2.4：调 Lua 函数、重载模块都在改正在运行的游戏，按运行时权限走（不像 lua.exec 每次确认，设计稿四.1）
    case 'lua.call':
    case 'lua.reload':
      return 'runtime'
    case 'pie':
      return args.action === 'start' || args.action === 'stop' ? 'runtime' : 'read'
    // GameTest（UEKit 扩展）：跑场景、单步、录制都在驱动正在运行的游戏
    case 'gt.run':
    case 'gt.step':
    case 'gt.record.start':
    case 'gt.record.mark':
    case 'gt.record.move':
    case 'gt.record.stop':
    // 录 UE 编辑器操作（GameTest 1.11.0）：只是开始盯编辑器事件，不改资产
    case 'gt.editrec.start':
    case 'gt.editrec.mark':
    case 'gt.editrec.stop':
      return 'runtime'
    // AssetForge：导入把配置写成资产并保存（演练只读），导出把资产写回配置文件
    case 'forge.import':
      return args.dryRun ? 'read' : 'save'
    case 'forge.export':
      return 'asset'
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
    // 导入外部文件、重新导入：会新建或整个换掉资源，不进撤销栈，按结构性操作确认
    case 'asset.import':
    case 'asset.reimport':
      return args.dryRun ? 'read' : 'struct'
    // 编辑器函数库的静态函数什么都能做（删资源、改设置……），和执行 Python 同一档权限
    case 'editor.call':
      return 'python'
    // 修复重定向器会改写、保存引用方并删掉重定向器；在关卡里放 / 删 Actor 改的是关卡：都按结构性操作确认
    case 'asset.redirectors':
      return args.fix ? 'struct' : 'read'
    case 'editor.spawn':
    case 'editor.destroy':
      return 'struct'
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
      if (args.array || args.class)
        return `${args.path} · ${args.prop} ${args.array ?? t('新建')}${args.index !== undefined ? ` [${args.index}]` : ''}${args.key !== undefined ? ` ${t('键')} ${v(args.key)}` : ''}${args.class ? ` ${args.class}` : ''}${args.array && args.value !== undefined ? ` = ${v(args.value)}` : ''}`
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
    case 'asset.redirectors':
      return `${t('修复重定向器')} ${args.path}`
    case 'asset.import':
      return `${t('导入')} → ${args.dest}${args.replace ? ` · ${t('覆盖已有的')}` : ''}\n${((args.files as string[]) ?? []).join('\n')}`
    case 'asset.reimport':
      return `${t('重新导入')} ${args.path}`
    case 'editor.call':
      return `${args.class}.${args.function}(${v(args.args ?? [])})${args.path ? ` · ${args.path}` : ''}`
    case 'editor.spawn':
      return `${t('在关卡里放')} ${args.class}${Array.isArray(args.location) ? ` @ ${(args.location as unknown[]).join(', ')}` : ''}${args.level ? ` · ${args.level}` : ''}`
    case 'editor.destroy':
      return `${t('从关卡里删掉')}\n${((args.actors as string[]) ?? []).join('\n')}`
    case 'bp.edit':
      return `${args.path}${args.dryRun ? ` · ${t('演练')}` : ''}\n${describeOps(args.ops)}`
    case 'bp.compile':
      return `${t('编译')} ${args.path}`
    case 'python':
      return String(args.code ?? '')
    case 'lua.set':
      return `${args.path || '_G'} · ${formatLuaPath((args.keys as LuaKey[]) ?? [])} = ${v(args.value ?? null)}`
    case 'lua.exec':
      return `${args.snippet ? `-- ${t('片段')} ${args.snippet}\n` : ''}${args.path ? `self = ${args.path}\n` : ''}${String(args.code ?? '')}`
    case 'lua.gm':
      return `Lua GM · ${String(args.code ?? '')}`
    case 'lua.call':
      return `${args.path || '_G'} · ${formatLuaPath((args.keys as LuaKey[]) ?? [])}${args.self ? ' (self)' : ''}(${((args.args as unknown[]) ?? []).map(v).join(', ')})`
    case 'lua.reload':
      return `${t('重载 Lua 模块')} ${args.changed ? t('改过的') : ((args.modules as string[]) ?? []).join(', ')}`
    case 'forge.import':
      return `AssetForge ${t('导入')}${args.dryRun ? ` · ${t('演练')}` : ''}\n${args.pending ? t('全部待导入') : ((args.configs as string[]) ?? []).join('\n')}`
    case 'forge.export':
      return `AssetForge ${t('导出到配置')}\n${((args.assets as string[]) ?? []).join('\n')}`
    case 'gt.run':
      return `GameTest ${t('运行')} ${args.scenario ?? (args.tag ? `tag:${args.tag}` : (args.name ?? ''))}`.trim()
    case 'gt.step': {
      const step = (args.step ?? args) as Record<string, unknown>
      return `GameTest ${step.action ?? ''} ${step.target ?? ''}`.trim()
    }
    case 'gt.record.start': {
      const insert = args.insert as { scenario?: string } | undefined
      return `GameTest ${t('开始录制')} ${args.name ?? ''}${insert?.scenario ? ` · ${t('接着录')} ${insert.scenario}` : ''}`.trim()
    }
    case 'gt.record.mark':
      return `GameTest ${t('检查点')} ${args.text ?? ''}`.trim()
    case 'gt.record.move':
      return `GameTest ${t('录制快捷动作')} ${args.phase ?? 'toggle'}`
    case 'gt.record.stop':
      return `GameTest ${t('停止录制')}${args.save === false ? ` · ${t('不保存')}` : ''}`
    case 'gt.editrec.start':
      return `GameTest ${t('开始录编辑器操作')} ${args.name ?? ''}`.trim()
    case 'gt.editrec.mark':
      return `GameTest ${t('检查点')} ${args.text ?? ''}`.trim()
    case 'gt.editrec.stop':
      return `GameTest ${t('停止录编辑器操作')}${args.save === false ? ` · ${t('不保存')}` : ''}`
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

/**
 * 设成只读的那一档：用户的指令优先（面板 ADR 0070，用户 2026-11-19 定），不再直接报错，
 * 弹确认卡问这一次放不放行；同意只放这一次，不改设置。不在对话里（没法弹卡）时 ask 照旧报错
 */
async function readOnlyAsk(ctx: OpCtx, title: string, what: string) {
  // 不在对话里（定时任务、网页外的调用）没法问：按设置拦下，原因写清是哪一档
  if (!ctx.confirm) throw new BridgeError(t('{title}（这次调用没法弹确认卡片，按设置拦下）：{what}', { title, what }))
  await ask(ctx, { title, detail: `${what}\n${t('同意只放行这一次，不改「权限与设置」。')}` })
}

/** Agent 的权限（设计文档 6）：你在网页上的操作不受这个限制 */
async function checkPerms(ctx: OpCtx, op: string, kind: Kind, args: Record<string, unknown>) {
  if (ctx.actor.kind !== 'agent') return
  const { runtime, asset, struct, python } = ctx.project.perms
  const what = describe(op, args)
  if (kind === 'runtime') {
    if (runtime === 'read') return readOnlyAsk(ctx, t('「权限与设置」里 Agent 对运行时是只读，这次放行吗'), what)
    // 任意 Lua 代码能做的事没有边界：不管权限设成什么，Agent 每次执行都先请你确认（用户 2026-11-10 定）
    // 例外：你在 Lua 页批准过的片段（代码没改过）按「运行时」权限走，不再逐次确认（设计稿四.4）
    const approved = op === 'lua.exec' && !!ctx.approvedLua && ctx.approvedLua === args.code
    if (op === 'lua.exec' && !approved) await ask(ctx, { title: t('Agent 要在 UE 里执行 Lua 代码'), detail: what })
    else if (runtime === 'ask') await ask(ctx, { title: t('Agent 要改正在运行的 UE'), detail: what })
  } else if (kind === 'asset') {
    if (asset === 'read') return readOnlyAsk(ctx, t('「权限与设置」里 Agent 对资源是只读，这次放行吗'), what)
  } else if (kind === 'struct') {
    if (struct === 'read')
      return readOnlyAsk(ctx, t('「权限与设置」里没有允许 Agent 新建、复制、改名，这次放行吗'), what)
    if (struct === 'ask')
      await ask(ctx, {
        title: op.startsWith('editor.') ? t('Agent 要改编辑器里打开的关卡') : t('Agent 要新建 / 复制 / 改名 UE 资源'),
        detail: what,
      })
  } else if (kind === 'delete') {
    if (struct === 'read') return readOnlyAsk(ctx, t('「权限与设置」里没有允许 Agent 删除资源，这次放行吗'), what)
    // 删除跟结构性操作同一档：设成「允许，不用问我」就不再确认（用户 2026-11-19 定）
    if (struct === 'ask') await ask(ctx, { title: t('Agent 要删除 UE 资源'), detail: what })
  } else if (kind === 'python') {
    if (python === 'read') return readOnlyAsk(ctx, t('「权限与设置」里没有打开「执行 Python」，这次放行吗'), what)
    if (python === 'ask') await ask(ctx, { title: t('Agent 要在 UE 编辑器里执行 Python'), detail: what })
  } else if (kind === 'save') {
    if (asset === 'read') return readOnlyAsk(ctx, t('「权限与设置」里 Agent 对资源是只读，要保存，这次放行吗'), what)
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
    const bg = cards.find((x) => x.kind === 'background')
    if (bg) return bg
    if (!autoBackground()) throw new BridgeError(noBackgroundMsg())
    return ensureBackground(ctx.project)
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
  // 2.4：原值是表、整个换掉的没有 prev，撤不回
  if (op === 'lua.set' && res.undoable === false) return { noUndo: t('原值是表，整个换掉后不能自动撤回') }
  if (op === 'lua.set')
    return { undo: { op: 'lua.set', args: { path: args.path, keys: args.keys, value: res.prev ?? null, world } } }
  if (op === 'lua.call') return { noUndo: t('调用 Lua 函数不能自动撤回') }
  if (op === 'lua.reload') return { noUndo: t('重载的模块不能自动撤回：改回文件再重载一次') }
  if (op === 'lua.exec') return { noUndo: t('执行的 Lua 代码不能自动撤回') }
  if (op === 'lua.gm') return { noUndo: t('命令、GM 和函数调用不能自动撤回') }
  if (op === 'cvar.set') return { undo: { op: 'cvar.set', args: { name: args.name, value: res.prev } } }
  if (op === 'log.clear') return { noUndo: t('清空日志不能撤回') }
  // 包在编辑器事务里的资源修改：按事务 id 撤同一步（之后编辑器里又有别的修改时桥接会拒绝）
  if (typeof res.tx === 'string' && res.tx && op !== 'asset.undo')
    return { undo: { op: 'asset.undo', args: { tx: res.tx, path: args.path } } }
  if (op === 'asset.import' || op === 'asset.reimport')
    return { noUndo: t('导入不能自动撤回：没保存前用「放弃改动」丢掉，已有资源被覆盖的用版本管理还原') }
  if (op === 'editor.call') return { noUndo: t('这个函数没有改动能记进撤销栈的对象，不能自动撤回') }
  if (op === 'python') return { noUndo: t('这次 Python 没有改资源，或者没包进事务，不能自动撤回') }
  if (op.startsWith('forge.')) return { noUndo: t('AssetForge 的导入导出不能自动撤回：用版本管理还原文件') }
  if (op.startsWith('gt.')) return { noUndo: t('测试步骤和录制不能撤回') }
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
  /** 长操作交给 UE 当作业跑（long-ops.ts）：没等到结果时回作业号，只给 Agent 工具用（网页按同步结果写的） */
  opts: { job?: boolean } = {},
): Promise<Record<string, unknown>> {
  const args = { ...rawArgs }
  const kind = kindOf(op, args)
  // 非蓝图函数（受保护、私有、没标 BlueprintCallable）只让网页上你自己点的执行；Agent 的 ue_call 只能调蓝图开放的（用户 2026-11-11 定）
  // 用户的指令优先（面板 ADR 0070）：不再直接拒绝，弹卡问这一次放不放行
  if (op === 'call' && args.any && ctx.actor.kind !== 'user')
    await ask(ctx, {
      title: t('Agent 要调用没有对蓝图开放的函数'),
      detail: `${describe(op, args)}\n${t('Agent 默认只能调用蓝图开放的函数（BlueprintCallable、Exec 或标了 AgentPanel 的），同意只放行这一次。')}`,
    })
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
  // 文件夹树：自己挑进程，没有编辑器或桥接旧时扫磁盘；不进 ASSET_OPS，免得为列目录启动后台编辑器（asset-folders.ts）
  if (op === 'assets.children') return { ...(await assetChildren(ctx, args, timeoutMs)) }
  // GameTest 对象引用：几个操作先核对 GameTest 版本，gt.props 补 Lua 声明字段（uekit/gt-ref/）。gt.migrate 随 v5 删掉（旧脚本不迁移）
  if (op === 'gt.migrate') throw new BridgeError(t('旧格式不再支持，请按新写法重写'))
  if (GT_REF_OPS.has(op))
    return gtRefOp(op, args, {
      project: ctx.project,
      pick: () => chooseCard(ctx, op, args),
      send: async (card, a) => ({
        ...(await rpc(card, op, a, timeoutMs)),
        instance: { pid: card.pid, kind: card.kind },
      }),
      offlineClasses: async (a, note) => ({ ...(await offlineClasses(ctx.project, a, note)) }),
    })
  // GameTest 的只读操作：编辑器没开（或网页说它正忙、要磁盘上的）时直接读场景、报告和历史文件（uekit/gt-disk.ts）
  if (
    GT_DISK_OPS.has(op) &&
    (args.disk === true || !(await liveCards(ctx.project.root)).some((x) => x.kind === 'editor'))
  )
    return gtFromDisk(ctx.project.root, op, args)
  // AssetForge 页先从磁盘列配置根下的 JSON（uekit/forge-disk.ts），同步状态再由 UE 补：不为了列文件等编辑器、拉后台编辑器
  if (FORGE_DISK_OPS.has(op) && args.disk === true) return forgeFromDisk(ctx.project.root, op, args)
  delete args.disk
  const card = await chooseCard(ctx, op, args)
  const world = String(args.world ?? ctx.target?.world ?? (ctx.target ? '' : ctx.project.target.world) ?? '')
  if (world && !args.world) args.world = world
  const added = op === 'asset.save' ? await checkout(ctx.project, card, (args.packages as string[]) ?? []) : []
  const batch = isBatchArgs(args)
  // 批量：每个资源都要占住（别的对话正改着没保存的不让动）；批量一律走作业
  if (kind === 'asset' && op !== 'asset.revert' && op !== 'asset.undo')
    for (const p of batch ? itemPaths(args) : [args.path]) await claim(ctx, card, packageOf(p))
  if (batch) opts = { ...opts, job: true }

  if (op === 'assets') return searchAssets(ctx, card, args, timeoutMs)
  // 蓝图演练：真实执行后桥接自己取消，不留改动，也不进操作记录
  if (kind === 'read' || (op === 'bp.edit' && args.dryRun)) {
    const instance = { pid: card.pid, kind: card.kind }
    if (opts.job) {
      const r = await runAsJob(card, op, args, timeoutMs)
      if (!r.done)
        keepJob(ctx.project.id, String(r.res.job), {
          card,
          finish: async (x) => ({ ...x, instance }),
          fail: async () => {},
        })
      return { ...r.res, instance }
    }
    const res = await rpc(card, op, args, timeoutMs)
    return { ...res, instance }
  }
  const base: Omit<HistoryItem, 'id' | 'at' | 'ok' | 'summary'> = {
    actor: ctx.actor,
    pid: card.pid,
    instanceKind: card.kind,
    // 资源不属于哪个世界：不带世界，PIE 停了也还能撤回
    world: kind === 'runtime' ? world : '',
    op,
  }
  const instance = { pid: card.pid, kind: card.kind }
  const fail = async (e: Error) => {
    await record(ctx.project.id, { ...base, summary: describe(op, args), ok: false, error: e.message })
  }
  // 拿到桥接的结果之后的收尾：P4、作业跟踪、释放占用、操作记录（作业晚到的结果也走这里）
  const finish = async (res: Record<string, unknown>) => {
    if (op === 'asset.save') res.vcs = await p4After(ctx.project, 'add', added)
    if (op === 'asset.delete' && res.onDisk)
      res.vcs = await p4After(ctx.project, 'delete', [String(res.file)], !!res.fileRemoved)
    // 后台编辑器没有推送通道：AssetForge 作业的进度由服务端转成推送（uekit/follow.ts）
    if (card.kind !== 'editor' && (op === 'forge.import' || op === 'forge.export') && typeof res.job === 'string')
      followJob(ctx.project, card, res.job)
    if (op === 'asset.save' || op === 'asset.revert') release(ctx.project, (args.packages as string[]) ?? [])
    const item = await record(ctx.project.id, {
      ...base,
      summary: describe(op, args),
      prev: res.prev,
      value: res.value ?? args.value,
      ok: true,
      ...(res.batch ? await batchUndo(op, res) : undoOf(op, args, res, String(res.world ?? world))),
    })
    return { ...res, instance, history: item.id }
  }
  try {
    if (opts.job && op !== 'python' && op !== 'lua.gm') {
      const r = await runAsJob(card, op, args, timeoutMs)
      if (r.done) return await finish(r.res)
      keepJob(ctx.project.id, String(r.res.job), { card, finish, fail })
      return { ...r.res, instance }
    }
    const res =
      op === 'python'
        ? await python(ctx, card, String(args.code ?? ''), timeoutMs)
        : op === 'lua.gm'
          ? // Lua GM（lua-gm/run.ts）：面板按扫描结果拼好的代码，桥接上就是 lua.exec；单独的操作名只为权限按「运行时」走
            await rpc(card, 'lua.exec', { code: args.code, timeoutMs: args.timeoutMs, world: args.world }, timeoutMs)
          : await rpc(card, op, args, timeoutMs)
    return await finish(res)
  } catch (e) {
    await fail(e as Error)
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
 * 输出是执行期间的日志（print 进 LogPython）。不给桥接加 Python 模块依赖：没启用这个插件的项目照样能编译桥接。
 * 安全网（python-run.ts）：整段包进编辑器事务，ue_undo 能整次撤回；执行前后比对没保存的包，记下这次改了哪些
 */
async function python(ctx: OpCtx, card: Card, code: string, timeoutMs: number) {
  if (!code.trim()) throw new BridgeError(t('没有给 Python 代码'))
  const dir = path.join(ctx.project.root, 'Saved', 'AgentPanel', 'py')
  await mkdir(dir, { recursive: true })
  const stamp = Date.now()
  const codeFile = path.join(dir, `code-${stamp}.py`)
  const file = path.join(dir, `run-${stamp}.py`)
  const tx = pythonTxId()
  await writeFile(codeFile, code, 'utf8')
  await writeFile(file, pythonWrapper(codeFile, tx), 'utf8')
  const dirtyNow = async () =>
    (
      ((await rpc(card, 'asset.dirty', {}, 15000).catch(() => ({}))) as { items?: { package: string }[] }).items ?? []
    ).map((i) => i.package)
  const before = await dirtyNow()
  try {
    // 控制台命令里路径用正斜杠：反斜杠加引号在 UE 的命令行解析里会被当成转义
    const res = await rpc(card, 'console', { command: `py "${file.replaceAll('\\', '/')}"` }, timeoutMs)
    const output = (res.output as string[]) ?? []
    if (output.some((l) => /command not recognized|unknown command/i.test(l) && /\bpy\b/i.test(l)))
      throw new BridgeError(
        t('编辑器不认识 py 命令：项目没有启用 Python Editor Script Plugin（编辑 → 插件里打开后重启编辑器）'),
      )
    const changed = newlyDirty(before, await dirtyNow())
    // 改了别的对话还没保存的包：已经改了收不回来，只能告诉 Agent 和用户
    const clash: string[] = []
    for (const pkg of changed) {
      const other = owners.get(ownerKey(ctx.project, pkg))
      if (other && ctx.actor.kind === 'agent' && other !== ctx.actor.taskId) clash.push(pkg)
      if (ctx.actor.kind === 'agent') owners.set(ownerKey(ctx.project, pkg), ctx.actor.taskId)
    }
    return {
      output,
      // 只有真改了包才给事务 id：什么都没改时引擎不留这次事务，ue_undo 也没得撤
      ...(changed.length && { tx, changed }),
      ...(clash.length && {
        warning: t('这些包另一个对话也改过、还没保存，脚本改动已经混在一起：{list}', { list: clash.join(', ') }),
      }),
    } as Record<string, unknown>
  } finally {
    await rm(file, { force: true })
    await rm(codeFile, { force: true })
  }
}
