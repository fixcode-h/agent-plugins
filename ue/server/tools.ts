import type { McpCallContext, McpTool } from '../../sdk/server.ts'
import { clearLogs, logTail, projectState, runMacro, undo } from './actions.ts'
import { ensureBackground, launchEditor, stopBackground } from './editor.ts'
import { waitEditorReady } from './launch/wait-ready.ts'
import { readHistory } from './history.ts'
import { crashes } from './logs.ts'
import { runOp, type OpCtx } from './ops.ts'
import { parseLuaPath } from './luapath.ts'
import { getProject } from './registry.ts'
import { PERF_DEFS } from './tools-perf.ts'
import type { Target } from './types.ts'
import { ASSET_ACTIONS, ASSET_TOOLS, assetAction, JOB_HINT } from './tools-asset.ts'
import { out, str, TARGET, tool } from './toolkit.ts'
import { mcpText } from './util.ts'
import { selfTestGate } from './self-test-gate.ts'
import { batchNudge } from './batch/nudge.ts'
import { findBySelect } from './batch/find-select.ts'
import { BATCH_HINT, BATCH_PROPS, runBatch } from './batch/run.ts'
import { knownGmFile } from './store.ts'
import { isBatch } from './batch/targets.ts'
import { dumpObject, readProps } from './object-dump.ts'
import { UE_GUIDES } from './tool-guides.ts'
import { EXT_TOOLS } from './uekit/tools-ext.ts'
import { FORGE_GUARDED, forgeNotice } from './uekit/forge-guard.ts'
import { runLuaGm } from './lua-gm/run.ts'
import { listGm } from './lua-gm/tool.ts'
import { removeGmDef } from './gm-custom/remove.ts'
import { runAdhoc } from './gm-custom/adhoc.ts'
import { runCustom } from './gm-custom/run.ts'
import { saveGmDef } from './gm-custom/save.ts'
import { findLua, LUA_DEV_ACTIONS, luaDevAction } from './lua/tool-actions.ts'
import { selectionBrief } from './selection.ts'
import { luaCompileTool } from './lua-build/tool.ts'
import { consoleConfig, consoleTags, editorDestroy, editorSpawn } from './editor-tools/tool-actions.ts'
import { openMap, startPie } from './editor-tools/map.ts'
import { pieLogSince } from './editor-tools/pie-log.ts'
import { liveCards } from './instances.ts'
import { DEBUG_ACTIONS, DEBUG_PROPS, debugAction } from './lua-debug/tool-actions.ts'
import { VS_TOOLS } from './vs-debug/tools.ts'

/**
 * 给 Agent 的工具（设计文档 5；ue_lua 是 UnLua 项目用的；ue_blueprint、ue_python 和资源通用动作在 tools-asset.ts，ue_perf、ue_capture 在 tools-perf.ts），MCP 服务名 ue。工具只在接入了 UE 的项目的对话里挂，
 * 每次调用按对话所在项目找登记；出错原样返回（面板硬规则：不悄悄重试）。结果先摘要、再细节，并限长。
 */
/** Lua 字段路径：没写返回 undefined（不走 Lua）；写了空串表示起点本身 */
const luaKeys = (v: unknown) => (v === undefined || v === null ? undefined : parseLuaPath(String(v)))

const DEFS = [
  tool(
    'ue_status',
    '看 UE 项目的状态：引擎、桥接插件、正在运行的进程和各自的世界（编辑器、PIE 客户端 / 服务器、游戏）、当前目标和 Agent 权限；编辑器开着时 selection 是编辑器里现在选中的 Actor、资源和蓝图节点（用户说「我选中的这个」就看它）。先调它再操作。',
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
          // 忙（同步加载、编译着色器、断点）不是断开：等它回应，不要另起编辑器
          busy: i.busy,
          error: i.error,
          worlds: i.worlds,
        })),
        background: s.background,
        selection: await selectionBrief(ctx),
      })
    },
  ),
  tool(
    'ue_console',
    '执行 UE 控制台命令，返回这条命令执行期间的输出；也能查和改控制台变量、看项目配置和 GameplayTag。action=run 执行 command；action=cvars 按 query 查变量（changed=true 只看改过的）；action=set 把变量 name 设成 value（可撤回）。危险命令（quit、open 等）会请用户确认。' +
      'action=config 看项目 ini 配置（UE 没开也能看磁盘上的各层）：不给 file 列有哪些配置；file=Engine 列 section（filter 筛名字）；再给 section（key 可选）看每个键在 Base / Default / 平台 / Saved 各层怎么写的、叠出来的值、最后定它的那层（last），UE 在运行时带上进程里的最终值（live），不一致标 differs；query 在全部配置里按键名、值搜。' +
      'action=tags 列 GameplayTag（query 按名字筛）；给 tag 列引用它的资源。',
    {
      action: { type: 'string', enum: ['run', 'cvars', 'set', 'config', 'tags'] },
      command: { type: 'string' },
      query: { type: 'string' },
      changed: { type: 'boolean' },
      name: { type: 'string' },
      value: { type: 'string' },
      file: { type: 'string' },
      section: { type: 'string' },
      key: { type: 'string' },
      filter: { type: 'string' },
      tag: { type: 'string' },
      target: TARGET,
    },
    [],
    async (a, ctx) => {
      const action = str(a.action) || (a.command ? 'run' : a.name ? 'set' : 'cvars')
      if (action === 'config') return consoleConfig(ctx, a)
      if (action === 'tags') return consoleTags(ctx, a)
      if (action === 'run') return out(await runOp(ctx, 'console', { command: a.command }))
      if (action === 'set') return out(await runOp(ctx, 'cvar.set', { name: a.name, value: str(a.value) }))
      return out(await runOp(ctx, 'cvars', { query: a.query ?? '', changed: !!a.changed, limit: 80 }))
    },
  ),
  tool(
    'ue_gm',
    'GM：action=list 列出 GM（参数类型、说明、所在模块），filter 按名字前缀筛。source 不写列项目的 C++（Exec 函数、UAgentPanelGMLibrary，要 UE 在运行）、Lua（扫描脚本列出，UE 没开也能列；参数的 table 是关联的配置表列，填值前可用 table.query 查）和自定义 GM；source=lua 只列 Lua 并重扫；source=engine 列引擎自带的；source=custom 列自定义 GM、对象列表和模块名；source=macro 列存的宏和步骤；source=recent 列用户在 GM 页最近执行的 20 条（参数、成功没有、输出）。' +
      'action=run 执行 name：args 按顺序给参数；Lua 写 source=lua，C++ 同名多处用 owner 指定类；source=custom 执行自定义 GM，args 写 {参数名: 值}，只能改它的 editable。action=macro 按名字执行存的宏（步骤可以是 {wait: 秒}；宏的 onFail=skip 时失败的步跳过接着做）。' +
      'action=call 临时对对象调函数 / 取值 / 改值、不存：def 写 {obj, function, args} 或 {obj, props: [属性路径]} 或 {obj, prop, value}，obj 是对象列表里的名字（参数里的 {"$obj": 名} 也按它现找）、匹配规则 {class, ident}（class 写 lua:模块名 时纯 Lua 实例也认，不用 luaref）或来源字符串 @pawn；按规则现找，命中多个时 many=first/each（改值不支持 each）。' +
      'action=save 存进团队共用的 gm.json（同名就改）：kind=gm 时 def 写一条自定义 GM {name, module（模块名，没有就新建）, obj, objects: {对象名: {ref: 匹配规则} 或 {src: "@pawn"}}, function, args（对象参数写 {"$obj": 对象名}）, params（可选，函数全部参数 [{name, type}]，没写进 args 的用默认值、editable 的执行时可填）, editable, many: error/first/each, kind: call/get/set, props（get 时读的属性路径）, prop（set 改的属性路径，新值写 args.value、editable 写 ["value"] 执行时可改）, note}；kind=object 时 def 写对象库（objects.json，GM 页对象调用和测试页共用）的一项 {name, ref} 或 {name, src}，folder 写放进哪个文件夹（a/b 分层，没有就新建；不写时新对象放进 Agent）；kind=macro 时 def 写 {name, steps: [{gm|lua|console|custom: 名字, args} 或 {wait: 秒}], onFail: stop/skip}。存前用 gt.validate 校验，有错不存；dryRun=true 只看结果。action=remove 删 kind + name，返回里列出还在用它的宏。',
    {
      action: { type: 'string', enum: ['list', 'run', 'call', 'macro', 'save', 'remove'] },
      source: { type: 'string', enum: ['cpp', 'lua', 'custom', 'engine', 'macro', 'recent'] },
      kind: { type: 'string', enum: ['gm', 'object', 'macro'] },
      name: { type: 'string' },
      owner: { type: 'string' },
      args: { type: ['array', 'object'] },
      def: { type: 'object' },
      dryRun: { type: 'boolean' },
      filter: { type: 'string' },
      target: TARGET,
    },
    ['action'],
    async (a, ctx) => {
      if (a.action === 'save' || a.action === 'remove') {
        const r = a.action === 'save' ? await saveGmDef(ctx, a) : await removeGmDef(ctx, a)
        // 实际改了 gm.json 时带上 changed（插件接口 3）：工具没标 edit，面板现在不记，留着和 targets 一致
        const wrote = 'saved' in r ? r.saved : 'removed' in r && r.removed
        return { ...out(r), ...(wrote ? { changed: [r.file] } : {}) }
      }
      if (a.action === 'run') {
        if (a.source === 'custom') {
          const args =
            a.args && typeof a.args === 'object' && !Array.isArray(a.args)
              ? (a.args as Record<string, unknown>)
              : undefined
          if (Array.isArray(a.args) && a.args.length) return mcpText('source=custom 的 args 写 {参数名: 值}', true)
          return out(await runCustom(ctx, str(a.name), args))
        }
        const list = Array.isArray(a.args) ? (a.args as unknown[]) : []
        return a.source === 'lua'
          ? out(await runLuaGm(ctx, str(a.name), list))
          : out(await runOp(ctx, 'gm.run', { name: a.name, owner: a.owner, args: list }))
      }
      if (a.action === 'call') return out(await runAdhoc(ctx, a))
      if (a.action === 'macro') return out(await runMacro(ctx, str(a.name)))
      return out(await listGm(ctx, str(a.source), str(a.filter)))
    },
    {
      // 不标 effect（按只读算）：面板的 effect 是整个工具一个值、不能按 action 分，标 edit 会让只读角色连 list / run 都被守卫挡住
      // （toolkit.ts 的约定）。save / remove 改的是团队共用的 gm.json，在 targets 里如实报出（演练不算），面板哪天按 action 区分时直接可用
      targets: (a, _root, projectId) =>
        (a.action === 'save' || a.action === 'remove') && !a.dryRun ? knownGmFile(projectId) : [],
    },
  ),
  tool(
    'ue_find',
    '找对象：kind=actor 按名字前缀找关卡里的 Actor（不区分大小写，比对对象名和编辑器显示名，空前缀不返回）；kind=component 列出 Actor（path）的组件；kind=object 按类名（class）和名字前缀找活着的 UObject（子系统、GameInstance、GameState、PlayerController…）；kind=lua 找绑定了 Lua 模块的对象（UnLua 项目），module 按模块名包含的文字筛，也可以加 class、prefix，结果带模块名；module 写完整模块名时 pure 里还有这个 Lua 类的纯 Lua 实例（Lua 框架自己 new、不绑 UObject 的表），它的 ref（luaref:编号）可当 ue_get / ue_set / ue_lua 的 path 用，换一局游戏失效，反复用的写成匹配规则 {class:"lua:模块名", ident} 交给 ue_gm action=call；kind=asset 按类型和名字前缀找资源（path 是目录，默认 /Game；prefix 也可以直接给 /Game 路径或磁盘上 Content 里的路径，会拆成目录 + 名字；编辑器没开时自动用后台编辑器）；名字通配符、父类、多个目录、标签用 select（写法同批量的 select，如 select={path:"/Game", class:"Blueprint", name:"*Box*"}，只列出路径不操作，total 是选中总数，offset / limit 翻页）；kind=node 跨蓝图搜节点：query 是调用的函数名、读写的变量名、转换的类名或节点标题里的文字，path 是目录（默认 /Game）或 blueprint 指定一个蓝图，结果给蓝图路径、图名和节点 id（逐个加载蓝图来扫，partial=true 表示没扫完，缩小目录再搜）。',
    {
      kind: { type: 'string', enum: ['actor', 'component', 'object', 'lua', 'asset', 'node'] },
      prefix: { type: 'string' },
      module: { type: 'string' },
      query: { type: 'string' },
      blueprint: { type: 'string' },
      class: { type: 'string' },
      path: { type: 'string' },
      select: BATCH_PROPS.select,
      offset: { type: 'number' },
      limit: { type: 'number' },
      target: TARGET,
    },
    ['kind'],
    async (a, ctx) => {
      const limit = Number(a.limit) || 50
      if (a.kind === 'node')
        return out(
          await runOp(
            ctx,
            'bp.find',
            { query: a.query ?? a.prefix, blueprint: a.blueprint, dir: a.path || '/Game', limit },
            150000,
          ),
        )
      if (a.kind === 'component') return out(await runOp(ctx, 'components', { path: a.path }))
      if (a.kind === 'object') return out(await runOp(ctx, 'objects', { class: a.class, prefix: a.prefix, limit }))
      if (a.kind === 'lua') return out(await findLua(a, ctx, limit))
      if (a.kind === 'asset' && isBatch({ select: a.select })) return out(await findBySelect(a, ctx))
      if (a.kind === 'asset')
        return out(await runOp(ctx, 'assets', { class: a.class, prefix: a.prefix, path: a.path || '/Game', limit }))
      return out(await runOp(ctx, 'actors', { prefix: a.prefix, limit }))
    },
  ),
  tool(
    'ue_get',
    '读对象属性。path 是对象路径（ue_find 给的，或资源路径 /Game/...；蓝图资源读的是类默认值）。不写 prop 列出所有属性（名字、类型、分类、是否同步、值；大的值是摘要），filter 按属性名前缀筛；写 prop 取一个属性的完整值，支持路径 Stats.MaxHP、Items[2].Count、Tags["Fire"]、Comp.Owner.Health。DataTable 的一行用 ue_asset。对象引用只给路径，要看子对象就用那个路径再读。UMG 控件（UserWidget 实例或里面的控件）写 tree=true 取控件树（名字、类、路径、可见性、子控件），再按控件路径读它的属性。属性结果里 readOnly=true 的不能改（readOnlyWhy 是原因）。props 给属性路径数组时一次读几个（最多 30 个）。file=true 把整个对象不截断写成 JSON 文件、只回路径和条数（Actor 带上各组件的属性，components=false 不带；写了 prop 时只导这个属性的完整值），要看全部数据、或值太大被截断时用它。\nUnLua 项目读 Lua 侧：写 lua 读对象 Lua 实例表里的字段（lua="" 列出实例表一层和模块函数，lua="Bag.Items[3]" 往下取）；不写 path 只写 lua 时从全局表 _G 开始（如 GameSystemManager.Players、package.loaded["Game.Core"]）。表一次列一层（offset / limit 分页），子表按路径再取。functions=true 时再列函数签名（参数名、定义的文件和行、继承自元表链第几层）、元表链和模块顶部的 local。' +
      '\n多个资源读同一个属性（比较一批蓝图的默认值）用 paths / select + prop。' +
      BATCH_HINT,
    {
      path: { type: 'string' },
      prop: { type: 'string' },
      props: { type: 'array', items: { type: 'string' } },
      filter: { type: 'string' },
      file: { type: 'boolean' },
      components: { type: 'boolean' },
      lua: { type: 'string' },
      offset: { type: 'number' },
      limit: { type: 'number' },
      tree: { type: 'boolean' },
      functions: { type: 'boolean' },
      ...BATCH_PROPS,
      target: TARGET,
    },
    [],
    async (a, ctx) => {
      // 批量：同一个属性（prop）或属性列表（filter）在多个资源上读，比较一批蓝图的默认值用
      if (isBatch(a)) return runBatch('ue_get', a, ctx)
      const keys = luaKeys(a.lua)
      // functions=true：字段之外列出函数签名（参数名、定义行、继承自哪层）、元表链和模块顶部的 local（UELink 2.4 的 lua.inspect）
      if (keys && a.functions)
        return out(
          await runOp(ctx, 'lua.inspect', {
            path: a.path ?? '',
            keys,
            offset: Number(a.offset) || 0,
            limit: Math.min(Number(a.limit) || 100, 500),
          }),
        )
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
      const objPath = str(a.path)
      if (a.file)
        return out(
          await dumpObject(ctx, objPath, {
            prop: a.prop ? str(a.prop) : undefined,
            filter: str(a.filter),
            components: a.components !== false,
          }),
        )
      if (Array.isArray(a.props) && a.props.length) return out(await readProps(ctx, objPath, a.props))
      return a.prop
        ? out(await runOp(ctx, 'get', { path: a.path, prop: a.prop }))
        : out(await runOp(ctx, 'props', { path: a.path, filter: a.filter ?? '', maxChars: 600 }))
    },
  ),
  tool(
    'ue_set',
    '改属性：path + prop（同 ue_get 的属性路径）+ value（JSON 值，或 UE 文本格式如 (X=1,Y=2,Z=3)）。**多个资源 / 组件改同一个属性时只调一次：paths=[全部路径]（或 select），不要逐个调、也不要并行发多次。**运行时对象的修改进操作记录、可用 ue_undo 撤回，停止 PIE 后不保留；同步属性在客户端改会被服务器盖掉，结果里 client=true 时改到服务器世界再试。资源（/Game/...）的修改只暂存在编辑器里（标脏），要用 ue_save 保存。\n' +
      '容器加删元素用 array，不整体替换（实例化子对象里的数据不会丢）：数组 add 末尾加、insert 在 index 前插、duplicate 复制第 index 个、remove 删第 index 个、clear 清空；add / insert 可带 value（新元素的值）或 class（元素是对象时新建这个类的内嵌子对象）。集合和映射按 key 增删：add / remove 给 key（元素或键），映射 add 可带 value 或 class；改映射已有键的值用 prop=名字[键] + value。\n' +
      '新建内嵌子对象（细节面板实例化属性的「选类」下拉，如输入触发器、修饰器、DataAsset 里的内嵌对象）：只给 class（原生类名或蓝图类路径），prop 可以是 Triggers[2] 这样的元素；结果里 created 是新子对象路径，接着用 ue_set path=created 改它的属性。集合 / 映射按键和 class 要 UELink 2.13。\n' +
      'UnLua 项目改 Lua 字段：写 lua（字段路径，同 ue_get）代替 prop；不写 path 时从全局表 _G 开始。只能改原值是数字、字符串、布尔或 nil 的字段，value 也只能是这几种（null 表示 nil），同样可以 ue_undo 撤回；表和函数用 ue_lua。' +
      '\nwhere 是这个属性期望的当前值，对不上就不改（skipped）。同一处修改作用到多个资源或关卡里的一类 Actor 用 paths / select（Lua 字段不支持批量）。' +
      BATCH_HINT,
    {
      path: { type: 'string' },
      prop: { type: 'string' },
      lua: { type: 'string' },
      value: {},
      array: { type: 'string', enum: ['add', 'insert', 'duplicate', 'remove', 'clear'] },
      index: { type: 'number' },
      key: {},
      class: { type: 'string' },
      where: {},
      ...BATCH_PROPS,
      target: TARGET,
    },
    [],
    async (a, ctx) => {
      // 批量：同一处修改作用到多个资源；资源上的 set 没有事务，失败回滚靠原值设回去
      if (isBatch(a)) return runBatch('ue_set', a, ctx)
      const keys = luaKeys(a.lua)
      if (keys) {
        if (!keys.length) return mcpText('lua 要写到具体字段，例如 Bag.Gold', true)
        return out(await runOp(ctx, 'lua.set', { path: a.path ?? '', keys, value: a.value ?? null }))
      }
      if (!a.path || !a.prop) return mcpText('要给 path 和 prop（改 Lua 字段时给 lua）', true)
      if (a.array || a.class)
        return out(
          await runOp(ctx, 'set', {
            path: a.path,
            prop: a.prop,
            ...(a.array ? { array: a.array } : {}),
            ...(a.index !== undefined ? { index: Number(a.index) } : {}),
            ...(a.key !== undefined ? { key: a.key } : {}),
            ...(a.value !== undefined ? { value: a.value } : {}),
            ...(a.class ? { class: String(a.class) } : {}),
          }),
        )
      return out(
        await runOp(ctx, 'set', {
          path: a.path,
          prop: a.prop,
          value: a.value,
          // UELink 2.14：当前值对得上才改
          ...(a.where !== undefined ? { where: a.where } : {}),
        }),
      )
    },
  ),
  tool(
    'ue_lua',
    'UnLua 项目的 Lua：action=exec（默认）执行 code（会请用户确认，用户可选本对话不再询问）：单个表达式直接返回值，多条语句用 return；print 和执行期间的日志在 output 里；返回表时列前 50 项，不超过 20 项的子表就地展开（depth 默认 2、最多 3，UELink 2.23），不用改成 print 拼字符串；path 给了对象时 self 是它的实例表；timeoutMs 默认 5000、最多 60000。' +
      '改完 .lua 的验证：check 只编译不执行（files 是 .lua 路径，相对项目目录；不开游戏也能查）→ reload 重载 modules（模块名）或 changed=true 重载改过还没重载的 → 触发后 errors 看有没有新报错（按消息和位置归并，带次数、调用栈；since 写上次结果的 seq 只看新的，clear=true 清空）。modules 列改过还没重载的模块（all=true 或 filter 列全部）。' +
      'call 调 Lua 函数（按运行时权限，不用每次确认）：lua 是函数路径（如 BagSystem.AddItem），path 给对象时从它的实例表开始，self=true 用 obj:fn() 的方式调，args 是参数数组（JSON，对象和数组转成 Lua 表）。只读字段用 ue_get（functions=true 看函数签名），改简单字段用 ue_set（能撤回）。\n' +
      'snippet（不带 code）执行用户在 Lua 页批准过的片段，不用确认；名字不对时回现有片段。snap 快照点（不暂停游戏）：file（文件或模块名）+ line 加，执行到时记局部变量和调用栈，hits 次后自动撤；id 看记录；remove=true 撤（不给 id 全撤）；都不给列全部。profile 采 seconds 秒（默认 5）按函数回用时和文件行（平铺总表；要看哪一帧慢、调用关系，改用 ue_perf 录含 Lua 的 trace）。leaks 列 Lua 还拿着、UObject 已销毁或世界已关的对象和引用路径。\n' +
      'compile 在本机跑 Lua 页「编译」里给增量 / 全编译选好的项目工具（/createtool 做的，不经过 UE）：mode=incremental（默认）只编上次成功以来改过的，full 全编译；最多等 20 秒，没编完返回 job，再带 job 调一次接着等；完整输出在 logFile。',
    {
      action: { type: 'string', enum: ['exec', 'compile', ...LUA_DEV_ACTIONS, ...DEBUG_ACTIONS] },
      code: { type: 'string' },
      path: { type: 'string' },
      lua: { type: 'string' },
      self: { type: 'boolean' },
      args: { type: 'array' },
      files: { type: 'array', items: { type: 'string' } },
      modules: { type: 'array', items: { type: 'string' } },
      changed: { type: 'boolean' },
      all: { type: 'boolean' },
      filter: { type: 'string' },
      since: { type: 'number' },
      clear: { type: 'boolean' },
      timeoutMs: { type: 'number' },
      depth: { type: 'number' },
      mode: { type: 'string', enum: ['incremental', 'full'] },
      job: { type: 'string' },
      ...DEBUG_PROPS,
      target: TARGET,
    },
    [],
    async (a, ctx) => {
      if (a.action === 'compile') return luaCompileTool(a, ctx)
      const dev = await luaDevAction(a, ctx)
      if (dev) return dev
      // 快照点、采样、持有的已销毁对象、按名字执行片段（lua-debug/tool-actions.ts）
      const dbg = await debugAction(str(a.action) || 'exec', a, ctx)
      if (dbg) return dbg
      if (!str(a.code).trim()) return mcpText('要给 code（执行 Lua）或 snippet（片段名），或写 action', true)
      const timeoutMs = Math.min(Math.max(Number(a.timeoutMs) || 5000, 100), 60000)
      const depth = Math.min(Math.max(Number(a.depth) || 2, 1), 3)
      return out(
        await runOp(ctx, 'lua.exec', { code: str(a.code), path: a.path ?? '', timeoutMs, depth }, timeoutMs + 10000),
      )
    },
  ),
  tool(
    'ue_call',
    '调函数：action=list 列出对象（path）上能调的函数（BlueprintCallable、Exec、标了 AgentPanel 元数据的）和参数；action=call 调 function，args 是对象（按参数名）或数组（按顺序）。返回值和输出参数在结果里。调用按 UE 页的运行时权限放行或请用户确认，不能自动撤回。' +
      '编辑器函数库（UELink 2.16）：给 class（如 EditorStaticMeshLibrary、EditorAssetLibrary）不给 path，list 列它的静态函数（不知道类名时用 query 搜），call 调用；按「执行 Python」权限放行，包进编辑器事务，ue_undo 能撤。对一批资源各调一次用 select / paths，args 里写 "{path}" 代表当前资源（如 {StaticMesh: "{path}", LODCount: 3}）。',
    {
      action: { type: 'string', enum: ['list', 'call'] },
      path: { type: 'string' },
      class: { type: 'string' },
      query: { type: 'string' },
      function: { type: 'string' },
      args: {},
      ...BATCH_PROPS,
      target: TARGET,
    },
    [],
    async (a, ctx) => {
      const call = a.action === 'call' || (!!a.function && a.action !== 'list')
      // 编辑器函数库：一批资源各调一次
      if (isBatch(a)) return runBatch('ue_call', a, ctx)
      if (a.class || (!a.path && a.query)) {
        if (!call) return out(await runOp(ctx, 'editor.functions', { class: a.class, query: a.query }))
        if (!a.function) return mcpText('action=call 要给 function', true)
        return out(await runOp(ctx, 'editor.call', { class: a.class, function: a.function, args: a.args ?? [] }))
      }
      if (!a.path) return mcpText('要给 path（对象路径），或给 class 调编辑器函数库', true)
      return call
        ? out(await runOp(ctx, 'call', { path: a.path, function: a.function, args: a.args ?? [] }))
        : out(await runOp(ctx, 'functions', { path: a.path }))
    },
  ),
  tool(
    'ue_asset',
    '资源：通用读写和 DataTable。' +
      '读：describe（摘要）；export（整份属性和内嵌子对象，depth 限深、offset / limit 分页，file=true 写成文件只回路径）；refs（direction=dependencies 它用了谁 / referencers 谁用了它 / both，hard 只看硬引用，depth 层数）；validate（数据校验，paths 一次查多个）。' +
      '结构性操作（按权限确认，dryRun=true 只检查）：create 新建（class 默认 Blueprint 要给 parent；DataTable 给 rowStruct；也可以是 DataAsset 子类、曲线）；duplicate 复制到 to；rename 改名或移动到 to（引用它的资源一起改）；delete 删除（有引用方时拒绝并列出，force=true 强删）。' +
      'DataTable：rows 分页读行（filter 筛行名前缀或单元格文字）；row 读一行；set 改单元格（row + column + value；row 给数组或通配符、或 where {列: 值} 按别的列挑行时一次改多行，结果带改前改后，dryRun 演练；多张表或不同列用 items）；add / remove / duplicate（给 row 时是复制行）/ rename 增删行（to 是新行名）。' +
      'import 导入 FBX、贴图等外部文件（files 磁盘路径 → to 目录，force 覆盖已有，先 dryRun）；reimport 按源文件重新导入。' +
      '没保存的改动：dirty 列出改了没保存的；revert 放弃改动；保存用 ue_save。open 在编辑器里打开。' +
      'help 列出某个类型（class）有哪些专用动作和参数。属性读写用 ue_get / ue_set，蓝图的图表和成员用 ue_blueprint。编辑器没开时走后台编辑器（默认不自动起，先 ue_editor background_start）。' +
      JOB_HINT +
      ' describe / refs / export / duplicate / rename / delete / reimport 能批量（export 批量时一律写文件）。' +
      BATCH_HINT,
    {
      action: { type: 'string', enum: ASSET_ACTIONS },
      path: { type: 'string' },
      to: { type: 'string' },
      class: { type: 'string' },
      parent: { type: 'string' },
      rowStruct: { type: 'string' },
      direction: { type: 'string', enum: ['dependencies', 'referencers', 'both'] },
      hard: { type: 'boolean' },
      depth: { type: 'number' },
      file: { type: 'boolean' },
      files: { type: 'array', items: { type: 'string' } },
      force: { type: 'boolean' },
      dryRun: { type: 'boolean' },
      // 改单元格时可以给行名数组或通配符（一次改多行）
      row: {},
      column: { type: 'string' },
      where: { type: 'object' },
      value: {},
      filter: { type: 'string' },
      offset: { type: 'number' },
      limit: { type: 'number' },
      packages: { type: 'array', items: { type: 'string' } },
      job: { type: 'string' },
      ...BATCH_PROPS,
      target: TARGET,
    },
    ['action'],
    async (a, ctx) => {
      const generic = await assetAction(a, ctx)
      if (generic) return generic
      switch (a.action) {
        case 'row':
          return out(await runOp(ctx, 'datatable.row', { path: a.path, row: a.row }))
        case 'set':
          return out(
            await runOp(ctx, 'datatable.set', {
              path: a.path,
              row: a.row,
              column: a.column,
              value: a.value,
              // UELink 2.14：row 给数组 / 通配符、或 where {列: 值} 时一次改多行
              ...(a.where ? { where: a.where } : {}),
              ...(a.dryRun ? { dryRun: true } : {}),
            }),
          )
        // duplicate / rename 带 row 时是 DataTable 的行操作，不带时是资源的复制 / 改名（assetAction 已经处理）
        case 'add':
        case 'remove':
        case 'duplicate':
        case 'rename':
          return out(await runOp(ctx, 'datatable.rows', { path: a.path, action: a.action, row: a.row, to: a.to }))
        case 'dirty':
          return out(await runOp(ctx, 'asset.dirty', {}))
        // 保存拆成了 ue_save（面板据此把写回的文件算进改动）；老会话里还按旧说明调的，指过去
        case 'save':
          return mcpText('保存改用 ue_save 工具（packages 参数不变）', true)
        case 'revert':
          return out(await runOp(ctx, 'asset.revert', { packages: a.packages ?? [] }, 120000))
        case 'open':
          return out(await runOp(ctx, 'asset.open', { path: a.path }))
        case 'rows':
          return out(
            await runOp(ctx, 'datatable', {
              path: a.path,
              filter: a.filter ?? '',
              offset: a.offset ?? 0,
              limit: a.limit ?? 50,
            }),
          )
        default:
          return mcpText(`不认识的 action：${a.action}`, true)
      }
    },
  ),
  tool(
    'ue_log',
    '日志：action=tail 取日志（since 是上次结果里的 cursor，只取之后的新行；pie=true 只取最近一次 ue_editor pie_start 之后的行，查这次 PIE 新出的错用它；category 按分类前缀、verbosity 最低级别 Error / Warning / Log、contains 关键字）；action=crashes 列出崩溃记录；action=clear 清空正在运行的 UE 的日志文件（不能撤回，backup=true 先另存一份）。UE 没在运行时读 Saved/Logs 里的文件。',
    {
      action: { type: 'string', enum: ['tail', 'crashes', 'clear'] },
      since: { type: 'number' },
      pie: { type: 'boolean' },
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
      let since = Number(a.since) || 0
      if (a.pie === true) {
        const card = (await liveCards(ctx.project.root)).find((c) => c.kind === 'editor')
        const m = pieLogSince(ctx.project.root, card?.pid)
        if ('error' in m) return mcpText(m.error, true)
        since = Math.max(since, m.since)
      }
      const r = await logTail(ctx, {
        since,
        limit: Math.min(Number(a.limit) || 200, 1000),
        category: str(a.category),
        verbosity: str(a.verbosity),
        contains: str(a.contains),
      })
      const lines = ((r.lines as { category: string; verbosity: string; text: string }[]) ?? []).map(
        (l) => `${l.category}${l.verbosity && l.verbosity !== 'Log' ? ` ${l.verbosity}` : ''}: ${l.text}`,
      )
      // out 截列表时留开头；日志要最新的，所以这里先从前面丢掉放不下的行，写明丢了几行
      let room = 10000
      let from = lines.length
      while (from > 0 && room - lines[from - 1].length - 3 > 0) room -= lines[--from].length + 3
      return out({
        cursor: r.cursor ?? 0,
        errors: r.errors ?? 0,
        warnings: r.warnings ?? 0,
        file: r.file ?? '',
        ...(!r.live && { note: 'UE 没在运行，读的是日志文件' }),
        ...(from > 0 && {
          dropped: from,
          dropHint: '更早的行太长没列出：加 category / verbosity / contains 筛，或直接读 file',
        }),
        lines: lines.slice(from),
      })
    },
  ),
  tool(
    'ue_screenshot',
    '截目标视口，图片直接返回：PIE / 游戏世界截游戏视口，默认含 UMG 界面（和玩家看到的一样，PIE 开在关卡视口里也只截视口），ui=false 只要场景；编辑器世界截编辑器视口。',
    { maxWidth: { type: 'number' }, ui: { type: 'boolean' }, target: TARGET },
    [],
    async (a, ctx) => {
      // ui：UELink 2.24 起认（截游戏视口控件，含 UMG），旧版忽略它照旧只截场景
      const args = { maxWidth: Number(a.maxWidth) || 1280, ...(a.ui === false && { ui: false }) }
      const r = (await runOp(ctx, 'screenshot', args, 20000)) as {
        png?: string
        width?: number
        height?: number
        world?: string
        ui?: boolean
        note?: string
      }
      if (!r.png) return mcpText('没有截到图', true)
      const tail = [r.ui && '含 UMG 界面', r.note].filter(Boolean).join(' · ')
      return {
        content: [
          { type: 'image', data: r.png, mimeType: 'image/png' },
          { type: 'text', text: `${r.width}×${r.height} · ${r.world}${tail ? ` · ${tail}` : ''}` },
        ],
      }
    },
  ),
  tool(
    'ue_editor',
    '编辑器控制：start_editor 启动编辑器（VS 开着这个项目时经 VS 按 F5 带调试器启动）；wait_ready 等编辑器可用（主窗口出来、资源扫完；面板或 VS 里启动后都用它，不要干等；timeoutMs 默认 180000、最多 600000，没就绪返回卡在哪，再调接着等）；open_map 让编辑器本身换图（map 写地图名、/Game 包名或 .umap；PIE 在跑会先停掉；关卡有没保存的改动时报错列出，unsaved=save 先保存、unsaved=discard 丢掉（请用户确认）；等加载完才返回，timeoutMs 默认 120000；不要用 ue_console open + sleep）；pie_start（map 只在 PIE 里玩这张图、不动编辑器里的图和没保存的改动，测试换图优先用它；players 玩家数、netMode 为 standalone / listen / client；window 默认 viewport 开进选中的视口，new 开独立窗口；等 PIE 世界起来才返回）、pie_stop、pie_status；livecoding 触发 Live Coding；background_start / background_stop 启停后台编辑器（编辑器没开时读资源用）；' +
      'spawn 在编辑器打开的关卡里放 Actor（class 写类名或蓝图路径，location [x,y,z]、rotation [pitch,yaw,roll]、label、level、folder 可选），destroy 删掉 actors（Actor 路径数组，ue_find kind=actor 找）。spawn / destroy 进撤销栈（ue_undo 能撤）、按结构性操作权限确认，PIE 运行中不能用，改完关卡要 ue_save 才落盘。',
    {
      action: {
        type: 'string',
        enum: [
          'start_editor',
          'wait_ready',
          'open_map',
          'pie_start',
          'pie_stop',
          'pie_status',
          'livecoding',
          'background_start',
          'background_stop',
          'spawn',
          'destroy',
        ],
      },
      map: { type: 'string' },
      unsaved: { type: 'string', enum: ['error', 'save', 'discard'] },
      reload: { type: 'boolean' },
      players: { type: 'number' },
      netMode: { type: 'string' },
      window: { type: 'string', enum: ['viewport', 'new'] },
      class: { type: 'string' },
      location: { type: 'array', items: { type: 'number' } },
      rotation: { type: 'array', items: { type: 'number' } },
      label: { type: 'string' },
      level: { type: 'string' },
      folder: { type: 'string' },
      actors: { type: 'array', items: { type: 'string' } },
      timeoutMs: { type: 'number' },
      target: TARGET,
    },
    ['action'],
    async (a, ctx) => {
      switch (a.action) {
        case 'start_editor': {
          const lp = await launchEditor(ctx.project)
          return out(
            lp.via === 'vs'
              ? {
                  via: 'vs',
                  note: 'VS 开着这个项目：已经让 VS 按 F5 启动（先编译再起编辑器，挂着调试器）。用 ue_editor action=wait_ready 等它可用；停在断点时用 ue_vs_inspect 看',
                }
              : { pid: lp.pid, note: '编辑器启动中：用 ue_editor action=wait_ready 等它可用' },
          )
        }
        case 'wait_ready':
          return out(await waitEditorReady(ctx.project, Number(a.timeoutMs) || undefined))
        case 'open_map':
          return out(await openMap(ctx, a))
        case 'pie_start':
          return out(await startPie(ctx, a))
        case 'pie_stop':
          return out(await runOp({ ...ctx, target: { instance: 'editor' } }, 'pie', { action: 'stop' }))
        case 'pie_status':
          return out(await runOp({ ...ctx, target: { instance: 'editor' } }, 'pie', { action: 'status' }))
        // build 不再给 Agent（ADR 0066 梳理，2026-11-15）：结果只能在 UE 页看、Agent 拿不到，又和面板的 request_build 重复；
        // 老会话还这么调时说清楚该用哪个，不悄悄吞掉
        case 'build':
          return mcpText(
            'ue_editor 不再提供 build：编译 C++ 由面板的 request_build（父对话）或 run_background 交编译命令，结果会推回给你；只改了已加载模块的代码时用 action=livecoding。',
            true,
          )
        case 'livecoding':
          return out(await runOp({ ...ctx, target: { instance: 'editor' } }, 'livecoding', {}, 120000))
        case 'background_start': {
          const card = await ensureBackground(ctx.project)
          return out({ pid: card.pid, port: card.port })
        }
        case 'background_stop':
          stopBackground(ctx.project.id)
          return out('已停止')
        case 'spawn':
          return out(await editorSpawn(ctx, a))
        case 'destroy':
          return out(await editorDestroy(ctx, a))
        default:
          return mcpText(`不认识的 action：${a.action}`, true)
      }
    },
  ),
  tool(
    'ue_undo',
    '撤回本对话做过的修改：运行时修改，以及还没保存的资源修改（蓝图操作列表、DataTable 单元格；要从最近的一步开始按顺序撤，中间编辑器里有别的修改时会拒绝）。不写 id 列出本对话的修改记录（id、改了什么、能不能撤回）；写 id 撤回那一条。',
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
  ...ASSET_TOOLS,
]

// 性能和内存分析的工具在 tools-perf.ts（单独一个文件，免得和这里的改动挤在一起）
DEFS.push(...PERF_DEFS)
// UEKit 扩展（AssetForge、GameTest）的工具在 uekit/tools-ext.ts
DEFS.push(...EXT_TOOLS)
// 通过 VS 调试 UE（UEToVS 的调试控制管道）的工具在 vs-debug/tools.ts
DEFS.push(...VS_TOOLS)

export const TOOL_NAMES = DEFS.map((d) => d.name)

/** 这一轮对话的工具：项目按对话所在的项目找（每次调用时重新读，登记改了不用重启对话） */
export function ueTools(projectId: string, root: string, agent: string): McpTool[] {
  return ueToolDefs().map(({ fn, targets, ...def }) => ({
    ...def,
    ...(targets && { targets: (args: Record<string, unknown>) => targets(args, root, projectId) }),
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
        // Agent 自己在游戏里测试前先过授权卡（self-test-gate.ts）：拒绝时把说明当工具结果交回
        const denied = await selfTestGate(def.name, args, ctx)
        if (denied) return mcpText(denied, true)
        // 对多个资源逐个调同一件事时提醒改用批量（batch/nudge.ts）
        const r = batchNudge(mctx.taskId, def.name, args, await fn(args, ctx))
        // 改到 AssetForge 纳管的资产时提醒先改配置（uekit/forge-guard.ts）
        return FORGE_GUARDED.has(def.name) ? await forgeNotice(def.name, args, ctx, r) : r
      } catch (e) {
        return mcpText((e as Error).message, true)
      }
    },
  }))
}

/** 不带 call 的工具定义（设置 →「MCP」的能力目录也用它，不用找项目） */
export function ueToolDefs() {
  return DEFS.map((d) => {
    const { confirms, irreversible, ...guide } = UE_GUIDES[d.name] ?? {}
    return {
      name: d.name,
      description: d.description,
      inputSchema: { type: 'object', properties: d.properties, required: d.required },
      ...(d.effect && { effect: d.effect }),
      ...(guide.title && { guide: guide as (typeof UE_GUIDES)[string] }),
      ...(confirms && { confirms }),
      ...(irreversible && { irreversible }),
      fn: d.fn,
      targets: d.targets,
    }
  })
}
