import type { McpCallContext, McpResult, McpTool } from '../../sdk/server.ts'
import { clearLogs, logTail, projectState, runMacro, undo } from './actions.ts'
import { ensureBackground, launchEditor, stopBackground } from './editor.ts'
import { readHistory } from './history.ts'
import { build } from './install.ts'
import { crashes } from './logs.ts'
import { runOp, type OpCtx } from './ops.ts'
import { parseLuaPath } from './luapath.ts'
import { getProject } from './registry.ts'
import { PERF_DEFS } from './tools-perf.ts'
import type { Target } from './types.ts'
import { clip, mcpText } from './util.ts'

/**
 * 给 Agent 的 15 个工具（设计文档 5；ue_lua 是 UnLua 项目用的；ue_perf、ue_capture 在 tools-perf.ts），MCP 服务名 ue。工具只在接入了 UE 的项目的对话里挂，
 * 每次调用按对话所在项目找登记；出错原样返回（面板硬规则：不悄悄重试）。结果先摘要、再细节，并限长。
 */
const TARGET = {
  type: 'object',
  description:
    '目标进程和世界：instance 写 PID 或 editor / game / server / background，world 写 editor、pie0、pie1、game；不填用 UE 页上选的目标',
  properties: { instance: { type: ['string', 'number'] }, world: { type: 'string' } },
}

const out = (data: unknown) => mcpText(clip(typeof data === 'string' ? data : JSON.stringify(data, null, 1)))
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))

type Handler = (a: Record<string, unknown>, ctx: OpCtx) => Promise<McpResult>

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[], fn: Handler) {
  return { name, description, properties, required, fn }
}

/** Lua 字段路径：没写返回 undefined（不走 Lua）；写了空串表示起点本身 */
const luaKeys = (v: unknown) => (v === undefined || v === null ? undefined : parseLuaPath(String(v)))

const DEFS = [
  tool(
    'ue_status',
    '看 UE 项目的状态：引擎、桥接插件、正在运行的进程和各自的世界（编辑器、PIE 客户端 / 服务器、游戏）、当前目标和 Agent 权限。先调它再操作。',
    {},
    [],
    async (_a, ctx) => {
      const s = await projectState(ctx.project)
      return out({
        project: { name: s.project.name, root: s.project.root, engine: s.project.engine.version, vcs: s.project.vcs },
        bridge: s.bridge || '未安装',
        target: s.project.target,
        perms: s.project.perms,
        instances: s.instances.map((i) => ({
          pid: i.pid,
          kind: i.kind,
          online: i.online,
          error: i.error,
          worlds: i.worlds,
        })),
        background: s.background,
      })
    },
  ),
  tool(
    'ue_console',
    '执行 UE 控制台命令，返回这条命令执行期间的输出；也能查和改控制台变量。action=run 执行 command；action=cvars 按 query 查变量（changed=true 只看改过的）；action=set 把变量 name 设成 value（可撤回）。危险命令（quit、open 等）会请用户确认。',
    {
      action: { type: 'string', enum: ['run', 'cvars', 'set'] },
      command: { type: 'string' },
      query: { type: 'string' },
      changed: { type: 'boolean' },
      name: { type: 'string' },
      value: { type: 'string' },
      target: TARGET,
    },
    [],
    async (a, ctx) => {
      const action = str(a.action) || (a.command ? 'run' : a.name ? 'set' : 'cvars')
      if (action === 'run') return out(await runOp(ctx, 'console', { command: a.command }))
      if (action === 'set') return out(await runOp(ctx, 'cvar.set', { name: a.name, value: str(a.value) }))
      return out(await runOp(ctx, 'cvars', { query: a.query ?? '', changed: !!a.changed, limit: 80 }))
    },
  ),
  tool(
    'ue_gm',
    'GM：action=list 列出所有 GM（Exec 函数、继承 UAgentPanelGMLibrary 的函数），带参数类型和说明，filter 按名字前缀筛；action=run 执行 name（args 按顺序给参数，同名多处时用 owner 指定类）；action=macro 按名字执行项目里存的宏。',
    {
      action: { type: 'string', enum: ['list', 'run', 'macro'] },
      name: { type: 'string' },
      owner: { type: 'string' },
      args: { type: 'array', items: { type: ['string', 'number', 'boolean'] } },
      filter: { type: 'string' },
      target: TARGET,
    },
    ['action'],
    async (a, ctx) => {
      if (a.action === 'run')
        return out(await runOp(ctx, 'gm.run', { name: a.name, owner: a.owner, args: a.args ?? [] }))
      if (a.action === 'macro') return out(await runMacro(ctx, str(a.name)))
      const r = (await runOp(ctx, 'gm.list', {})) as { items?: { name: string }[] }
      const f = str(a.filter).toLowerCase()
      return out((r.items ?? []).filter((i) => !f || i.name.toLowerCase().startsWith(f)))
    },
  ),
  tool(
    'ue_find',
    '找对象：kind=actor 按名字前缀找关卡里的 Actor（不区分大小写，比对对象名和编辑器显示名，空前缀不返回）；kind=component 列出 Actor（path）的组件；kind=object 按类名（class）和名字前缀找活着的 UObject（子系统、GameInstance、GameState、PlayerController…）；kind=lua 找绑定了 Lua 模块的对象（UnLua 项目），module 按模块名包含的文字筛，也可以加 class、prefix，结果带模块名；kind=asset 按类型和名字前缀找资源（path 是目录，默认 /Game；prefix 也可以直接给 /Game 路径或磁盘上 Content 里的路径，会拆成目录 + 名字；编辑器没开时自动用后台编辑器）。',
    {
      kind: { type: 'string', enum: ['actor', 'component', 'object', 'lua', 'asset'] },
      prefix: { type: 'string' },
      module: { type: 'string' },
      class: { type: 'string' },
      path: { type: 'string' },
      limit: { type: 'number' },
      target: TARGET,
    },
    ['kind'],
    async (a, ctx) => {
      const limit = Number(a.limit) || 50
      if (a.kind === 'component') return out(await runOp(ctx, 'components', { path: a.path }))
      if (a.kind === 'object') return out(await runOp(ctx, 'objects', { class: a.class, prefix: a.prefix, limit }))
      if (a.kind === 'lua')
        return out(await runOp(ctx, 'lua.objects', { class: a.class, prefix: a.prefix, module: a.module, limit }))
      if (a.kind === 'asset')
        return out(await runOp(ctx, 'assets', { class: a.class, prefix: a.prefix, path: a.path || '/Game', limit }))
      return out(await runOp(ctx, 'actors', { prefix: a.prefix, limit }))
    },
  ),
  tool(
    'ue_get',
    '读对象属性。path 是对象路径（ue_find 给的，或资源路径 /Game/...；蓝图资源读的是类默认值）。不写 prop 列出所有属性（名字、类型、分类、是否同步、值；大的值是摘要），filter 按属性名前缀筛；写 prop 取一个属性的完整值，支持路径 Stats.MaxHP、Items[2].Count、Tags["Fire"]、Comp.Owner.Health。DataTable 的一行用 ue_asset。对象引用只给路径，要看子对象就用那个路径再读。UMG 控件（UserWidget 实例或里面的控件）写 tree=true 取控件树（名字、类、路径、可见性、子控件），再按控件路径读它的属性。属性结果里 readOnly=true 的不能改（readOnlyWhy 是原因）。\nUnLua 项目读 Lua 侧：写 lua 读对象 Lua 实例表里的字段（lua="" 列出实例表一层和模块函数，lua="Bag.Items[3]" 往下取）；不写 path 只写 lua 时从全局表 _G 开始（如 GameSystemManager.Players、package.loaded["Game.Core"]）。表一次列一层（offset / limit 分页），子表按路径再取。',
    {
      path: { type: 'string' },
      prop: { type: 'string' },
      filter: { type: 'string' },
      lua: { type: 'string' },
      offset: { type: 'number' },
      limit: { type: 'number' },
      tree: { type: 'boolean' },
      target: TARGET,
    },
    [],
    async (a, ctx) => {
      const keys = luaKeys(a.lua)
      if (keys)
        return out(
          await runOp(ctx, 'lua.get', {
            path: a.path ?? '',
            keys,
            offset: Number(a.offset) || 0,
            limit: Math.min(Number(a.limit) || 100, 500),
          }),
        )
      if (!a.path) return mcpText('要给 path（对象路径），读 Lua 全局表时给 lua', true)
      if (a.tree) return out(await runOp(ctx, 'umg.tree', { path: a.path }))
      return a.prop
        ? out(await runOp(ctx, 'get', { path: a.path, prop: a.prop }))
        : out(await runOp(ctx, 'props', { path: a.path, filter: a.filter ?? '', maxChars: 600 }))
    },
  ),
  tool(
    'ue_set',
    '改属性：path + prop（同 ue_get 的属性路径）+ value（JSON 值，或 UE 文本格式如 (X=1,Y=2,Z=3)）。运行时对象的修改进操作记录、可用 ue_undo 撤回，停止 PIE 后不保留；同步属性在客户端改会被服务器盖掉，结果里 client=true 时改到服务器世界再试。资源（/Game/...）的修改只暂存在编辑器里（标脏），要用 ue_asset save 保存。\nUnLua 项目改 Lua 字段：写 lua（字段路径，同 ue_get）代替 prop；不写 path 时从全局表 _G 开始。只能改原值是数字、字符串、布尔或 nil 的字段，value 也只能是这几种（null 表示 nil），同样可以 ue_undo 撤回；表和函数用 ue_lua。',
    {
      path: { type: 'string' },
      prop: { type: 'string' },
      lua: { type: 'string' },
      value: {},
      target: TARGET,
    },
    ['value'],
    async (a, ctx) => {
      const keys = luaKeys(a.lua)
      if (keys) {
        if (!keys.length) return mcpText('lua 要写到具体字段，例如 Bag.Gold', true)
        return out(await runOp(ctx, 'lua.set', { path: a.path ?? '', keys, value: a.value ?? null }))
      }
      if (!a.path || !a.prop) return mcpText('要给 path 和 prop（改 Lua 字段时给 lua）', true)
      return out(await runOp(ctx, 'set', { path: a.path, prop: a.prop, value: a.value }))
    },
  ),
  tool(
    'ue_lua',
    '在 UE 的 UnLua 环境里执行 Lua 代码（每次都会请用户确认）。code 是代码：单个表达式直接返回它的值（如 GameSystemManager:GetCount()），多条语句用 return 返回结果；print 的内容和执行期间的日志在 output 里。path 给了对象时代码里的 self 是它的 Lua 实例表。timeoutMs 超时中止（默认 5000，最多 60000）。只读字段优先用 ue_get，改简单字段用 ue_set（能撤回）。',
    {
      code: { type: 'string' },
      path: { type: 'string' },
      timeoutMs: { type: 'number' },
      target: TARGET,
    },
    ['code'],
    async (a, ctx) => {
      const timeoutMs = Math.min(Math.max(Number(a.timeoutMs) || 5000, 100), 60000)
      return out(await runOp(ctx, 'lua.exec', { code: str(a.code), path: a.path ?? '', timeoutMs }, timeoutMs + 10000))
    },
  ),
  tool(
    'ue_call',
    '调函数：action=list 列出对象（path）上能调的函数（BlueprintCallable、Exec、标了 AgentPanel 元数据的）和参数；action=call 调 function，args 是对象（按参数名）或数组（按顺序）。返回值和输出参数在结果里。',
    {
      action: { type: 'string', enum: ['list', 'call'] },
      path: { type: 'string' },
      function: { type: 'string' },
      args: {},
      target: TARGET,
    },
    ['path'],
    async (a, ctx) =>
      a.action === 'call' || a.function
        ? out(await runOp(ctx, 'call', { path: a.path, function: a.function, args: a.args ?? [] }))
        : out(await runOp(ctx, 'functions', { path: a.path })),
  ),
  tool(
    'ue_asset',
    '资源和 DataTable：action=rows 读 DataTable（path）的行（filter 筛行名前缀或单元格文字，offset / limit 分页）；row 读一行全部字段；set 改单元格（row + column + value）；add / remove / duplicate / rename 增删行（to 是新行名）；dirty 列出改了没保存的资源；save 保存 packages（P4 先签出，按权限请用户确认）；revert 放弃 packages 的改动；open 在编辑器里打开资源。编辑器没开时读写走后台编辑器。',
    {
      action: {
        type: 'string',
        enum: ['rows', 'row', 'set', 'add', 'remove', 'duplicate', 'rename', 'dirty', 'save', 'revert', 'open'],
      },
      path: { type: 'string' },
      row: { type: 'string' },
      column: { type: 'string' },
      value: {},
      to: { type: 'string' },
      filter: { type: 'string' },
      offset: { type: 'number' },
      limit: { type: 'number' },
      packages: { type: 'array', items: { type: 'string' } },
      target: TARGET,
    },
    ['action'],
    async (a, ctx) => {
      switch (a.action) {
        case 'row':
          return out(await runOp(ctx, 'datatable.row', { path: a.path, row: a.row }))
        case 'set':
          return out(await runOp(ctx, 'datatable.set', { path: a.path, row: a.row, column: a.column, value: a.value }))
        case 'add':
        case 'remove':
        case 'duplicate':
        case 'rename':
          return out(await runOp(ctx, 'datatable.rows', { path: a.path, action: a.action, row: a.row, to: a.to }))
        case 'dirty':
          return out(await runOp(ctx, 'asset.dirty', {}))
        case 'save':
          return out(await runOp(ctx, 'asset.save', { packages: a.packages ?? [] }, 120000))
        case 'revert':
          return out(await runOp(ctx, 'asset.revert', { packages: a.packages ?? [] }, 120000))
        case 'open':
          return out(await runOp(ctx, 'asset.open', { path: a.path }))
        default:
          return out(
            await runOp(ctx, 'datatable', {
              path: a.path,
              filter: a.filter ?? '',
              offset: a.offset ?? 0,
              limit: a.limit ?? 50,
            }),
          )
      }
    },
  ),
  tool(
    'ue_log',
    '日志：action=tail 取日志（since 是上次结果里的 cursor，只取之后的新行；category 按分类前缀、verbosity 最低级别 Error / Warning / Log、contains 关键字）；action=crashes 列出崩溃记录；action=clear 清空正在运行的 UE 的日志文件（不能撤回，backup=true 先另存一份）。UE 没在运行时读 Saved/Logs 里的文件。',
    {
      action: { type: 'string', enum: ['tail', 'crashes', 'clear'] },
      since: { type: 'number' },
      limit: { type: 'number' },
      category: { type: 'string' },
      verbosity: { type: 'string' },
      contains: { type: 'string' },
      backup: { type: 'boolean' },
      target: TARGET,
    },
    [],
    async (a, ctx) => {
      if (a.action === 'crashes') return out(await crashes(ctx.project))
      if (a.action === 'clear') {
        const pid = ctx.target?.instance
        return out(await clearLogs(ctx, typeof pid === 'number' ? [pid] : undefined, !!a.backup))
      }
      const r = await logTail(ctx, {
        since: Number(a.since) || 0,
        limit: Math.min(Number(a.limit) || 200, 1000),
        category: str(a.category),
        verbosity: str(a.verbosity),
        contains: str(a.contains),
      })
      const lines = ((r.lines as { category: string; verbosity: string; text: string }[]) ?? []).map(
        (l) => `${l.category}${l.verbosity && l.verbosity !== 'Log' ? ` ${l.verbosity}` : ''}: ${l.text}`,
      )
      return out(
        `cursor=${r.cursor ?? 0} errors=${r.errors ?? 0} warnings=${r.warnings ?? 0} file=${r.file ?? ''}${r.live ? '' : '（UE 没在运行，读的是日志文件）'}\n${lines.join('\n')}`,
      )
    },
  ),
  tool(
    'ue_screenshot',
    '截目标视口（PIE / 游戏窗口，编辑器世界截编辑器视口），图片直接返回。',
    { maxWidth: { type: 'number' }, target: TARGET },
    [],
    async (a, ctx) => {
      const r = (await runOp(ctx, 'screenshot', { maxWidth: Number(a.maxWidth) || 1280 }, 20000)) as {
        png?: string
        width?: number
        height?: number
        world?: string
      }
      if (!r.png) return mcpText('没有截到图', true)
      return {
        content: [
          { type: 'image', data: r.png, mimeType: 'image/png' },
          { type: 'text', text: `${r.width}×${r.height} · ${r.world}` },
        ],
      }
    },
  ),
  tool(
    'ue_editor',
    '编辑器控制：start_editor 启动编辑器；pie_start（players 玩家数、netMode 为 standalone / listen / client）、pie_stop、pie_status；build 编译项目（含桥接插件，返回作业 id，用 UE 页看输出）；livecoding 触发 Live Coding；background_start / background_stop 启停后台编辑器（编辑器没开时读资源用）。',
    {
      action: {
        type: 'string',
        enum: [
          'start_editor',
          'pie_start',
          'pie_stop',
          'pie_status',
          'build',
          'livecoding',
          'background_start',
          'background_stop',
        ],
      },
      players: { type: 'number' },
      netMode: { type: 'string' },
      target: TARGET,
    },
    ['action'],
    async (a, ctx) => {
      switch (a.action) {
        case 'start_editor':
          return out({ pid: launchEditor(ctx.project), note: '编辑器启动中，加载完桥接会自动连上，用 ue_status 看' })
        case 'pie_start':
          return out(
            await runOp({ ...ctx, target: { instance: 'editor' } }, 'pie', {
              action: 'start',
              players: a.players ?? 1,
              netMode: a.netMode ?? 'standalone',
            }),
          )
        case 'pie_stop':
          return out(await runOp({ ...ctx, target: { instance: 'editor' } }, 'pie', { action: 'stop' }))
        case 'pie_status':
          return out(await runOp({ ...ctx, target: { instance: 'editor' } }, 'pie', { action: 'status' }))
        case 'build': {
          const job = await build(ctx.project)
          if (job.hint)
            return mcpText(
              `编译没开始：${job.log.join('\n')}\n请用户保存并关掉编辑器后再编译；只改了已加载模块的代码时可以改用 action=livecoding。`,
              true,
            )
          return out({ job: job.id, status: job.status })
        }
        case 'livecoding':
          return out(await runOp({ ...ctx, target: { instance: 'editor' } }, 'livecoding', {}, 120000))
        case 'background_start': {
          const card = await ensureBackground(ctx.project)
          return out({ pid: card.pid, port: card.port })
        }
        case 'background_stop':
          stopBackground(ctx.project.id)
          return out('已停止')
        default:
          return mcpText(`不认识的 action：${a.action}`, true)
      }
    },
  ),
  tool(
    'ue_undo',
    '撤回本对话做过的运行时修改：不写 id 列出本对话的修改记录（id、改了什么、能不能撤回）；写 id 撤回那一条。',
    { id: { type: 'string' } },
    [],
    async (a, ctx) => {
      if (a.id) return out(await undo(ctx, str(a.id)))
      const taskId = ctx.actor.kind === 'agent' ? ctx.actor.taskId : ''
      const items = (await readHistory(ctx.project.id)).filter(
        (i) => i.actor.kind === 'agent' && i.actor.taskId === taskId,
      )
      return out(
        items.map((i) => ({
          id: i.id,
          at: i.at,
          op: i.op,
          summary: i.summary,
          ok: i.ok,
          undo: !!i.undo && !i.undone,
          noUndo: i.noUndo,
        })),
      )
    },
  ),
]

// 性能和内存分析的工具在 tools-perf.ts（单独一个文件，免得和这里的改动挤在一起）
DEFS.push(...PERF_DEFS)

export const TOOL_NAMES = DEFS.map((d) => d.name)

/** 这一轮对话的工具：项目按对话所在的项目找（每次调用时重新读，登记改了不用重启对话） */
export function ueTools(projectId: string, agent: string): McpTool[] {
  return DEFS.map((d) => ({
    name: d.name,
    description: d.description,
    inputSchema: { type: 'object', properties: d.properties, required: d.required },
    call: async (args: Record<string, unknown>, mctx: McpCallContext) => {
      const project = await getProject(projectId)
      if (!project) return mcpText('这个项目已经从 UE 页移除了', true)
      const target = args.target as Target | undefined
      const ctx: OpCtx = {
        project,
        actor: { kind: 'agent', taskId: mctx.taskId, agent },
        confirm: mctx.confirm,
        target: target && (target.instance !== undefined || target.world) ? target : undefined,
      }
      try {
        return await d.fn(args, ctx)
      } catch (e) {
        return mcpText((e as Error).message, true)
      }
    },
  }))
}
