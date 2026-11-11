import type { McpResult } from '../../sdk/server.ts'
import { packageToDisk } from './asset-query.ts'
import { runOp, type OpCtx } from './ops.ts'
import { out, str, TARGET, tool } from './toolkit.ts'
import { mcpText } from './util.ts'

/**
 * 资源和蓝图读写的工具（设计稿「UE 插件扩充设计：资源与蓝图读写」，在仓库 ue/docs/asset-blueprint-design.md）：
 * ue_asset 的通用动作、ue_blueprint、ue_python。各资源类型的专用动作不全写进工具说明，用 ue_asset action=help 现查，
 * 加类型时只加下面 HELP 里的一项和桥接的操作，不改工具定义。
 */

export const ASSET_ACTIONS = [
  'describe',
  'export',
  'refs',
  'validate',
  'create',
  'duplicate',
  'rename',
  'delete',
  'rows',
  'row',
  'set',
  'add',
  'remove',
  'dirty',
  'revert',
  'open',
  'help',
]

/** 蓝图的几种资源类：它们的专用动作都在 ue_blueprint */
const BLUEPRINT_CLASSES = ['blueprint', 'widgetblueprint', 'animblueprint', 'blueprintgeneratedclass']

const HELP: Record<string, unknown> = {
  通用: {
    说明: '对任何资源都能用。属性读写用 ue_get / ue_set（path 写资源路径，prop 写属性路径）',
    动作: {
      describe: 'path',
      export: 'path, depth?, offset?, limit?, file?',
      refs: 'path, direction?(dependencies|referencers|both), hard?, depth?, limit?',
      validate: 'path',
      create: 'path, class?(默认 Blueprint), parent?(蓝图父类), rowStruct?(DataTable 行结构), dryRun?',
      duplicate: 'path, to, dryRun?',
      rename: 'path, to, dryRun?（也用来移动目录）',
      delete: 'path, force?, dryRun?',
      'dirty / revert': 'packages?（不给就是所有改了没保存的）；保存用 ue_save 工具',
      open: 'path',
    },
  },
  DataTable: {
    说明: '行编辑；改动包在编辑器事务里，set 可以 ue_undo 撤回',
    动作: {
      rows: 'path, filter?, offset?, limit?',
      row: 'path, row',
      set: 'path, row, column, value',
      'add / remove': 'path, row',
      duplicate: 'path, row, to（带 row 时是复制行）',
      rename: 'path, row, to（带 row 时是行改名）',
    },
  },
  Blueprint: {
    说明: '蓝图的成员、组件和图表用 ue_blueprint；类默认值用 ue_get / ue_set（path 写蓝图资源路径）',
    动作: {
      'ue_blueprint outline': 'path',
      'ue_blueprint graph': 'path, graph?, node?, format?(pseudo|json), around?, hops?, offset?, limit?',
      'ue_blueprint node_search': 'path, graph?, query',
      'ue_blueprint edit': 'path, ops[], dryRun?, compile?',
      'ue_compile（单独的工具）': 'path：编译并给出通过没有，保存前用它确认'
    },
  },
  DataAsset: { 说明: '没有专用动作：describe / export 看内容，ue_get / ue_set 读改属性' },
}

function help(cls: string) {
  const want = cls.toLowerCase()
  if (!want) return { 类型: Object.keys(HELP), 提示: '给 class 看某个类型的动作；没列出的类型只有「通用」动作' }
  if (BLUEPRINT_CLASSES.includes(want)) return { 通用: HELP.通用, Blueprint: HELP.Blueprint }
  const key = Object.keys(HELP).find((k) => k.toLowerCase() === want)
  return key && key !== '通用'
    ? { 通用: HELP.通用, [key]: HELP[key] }
    : { 通用: HELP.通用, 提示: `${cls} 没有专用动作，用通用动作和 ue_get / ue_set` }
}

/** ue_asset 的通用动作；不是这里管的 action 返回 undefined，交回 tools.ts 里 DataTable 和保存那几个 */
export async function assetAction(a: Record<string, unknown>, ctx: OpCtx): Promise<McpResult | undefined> {
  const need = (...keys: string[]) => {
    const miss = keys.filter((k) => !a[k])
    return miss.length ? mcpText(`action=${a.action} 要给 ${miss.join('、')}`, true) : undefined
  }
  switch (a.action) {
    case 'help':
      return out(help(str(a.class)))
    case 'describe':
      return need('path') ?? out(await runOp(ctx, 'asset.describe', { path: a.path }, 120000))
    case 'export':
      return (
        need('path') ??
        out(
          await runOp(
            ctx,
            'asset.export',
            { path: a.path, depth: a.depth, offset: a.offset, limit: a.limit, file: !!a.file },
            120000,
          ),
        )
      )
    case 'refs':
      return (
        need('path') ??
        out(
          await runOp(
            ctx,
            'asset.refs',
            { path: a.path, direction: a.direction ?? 'both', hard: !!a.hard, depth: a.depth, limit: a.limit },
            120000,
          ),
        )
      )
    case 'validate':
      return need('path') ?? out(await runOp(ctx, 'asset.validate', { path: a.path }, 120000))
    case 'create':
      return (
        need('path') ??
        out(
          await runOp(
            ctx,
            'asset.create',
            {
              path: a.path,
              class: a.class ?? 'Blueprint',
              parent: a.parent,
              rowStruct: a.rowStruct,
              dryRun: !!a.dryRun,
            },
            120000,
          ),
        )
      )
    case 'duplicate':
    case 'rename':
      // 带 row 的是 DataTable 的行操作
      if (a.row) return undefined
      return (
        need('path', 'to') ??
        out(await runOp(ctx, `asset.${a.action}`, { path: a.path, to: a.to, dryRun: !!a.dryRun }, 300000))
      )
    case 'delete':
      return (
        need('path') ??
        out(await runOp(ctx, 'asset.delete', { path: a.path, force: !!a.force, dryRun: !!a.dryRun }, 300000))
      )
    default:
      return undefined
  }
}

const EDIT_HELP = `ops 是操作数组，整批在一个编辑器事务里执行，任一步失败整批取消。每个操作 {op, ...}：
成员：add_variable {name, type, default?, category?, instanceEditable?, replicated?, exposeOnSpawn?}；set_variable {name, type?, rename?, default?, …同上}；remove_variable {name}；add_function {name, inputs?:[{name,type}], outputs?:[{name,type}], pure?}；remove_function {name}。
类设置：add_interface / remove_interface {interface}；reparent {parent}；set_default {prop, value}（类默认值，prop 同 ue_get 的属性路径）。
组件：add_component {name, class, parent?}；remove_component {name}；set_component {name, prop, value}。
节点（graph 不写是事件图）：add_node {graph?, as?, spawner 或 kind, x?, y?, comment?, pins?:{引脚名:默认值}}，kind 有 call {function:"类名.函数名"}、get / set {variable}、branch、sequence、cast {class}、self、event {name:"BeginPlay"}（重写父类事件）、custom_event {name, inputs?}、macro {macro:"ForEachLoop"}，其余节点先 node_search 拿 spawner；remove_node {node}；set_pin {pin:"节点.引脚", value}；connect / disconnect {from:"节点.引脚", to:"节点.引脚"}（disconnect 不写 to 是断开这个引脚的所有连线）；move {node, x, y}；comment {graph?, text, nodes?:[节点]}。
类型写法：bool、int、int64、float、byte、name、string、text、结构体名（Vector、Rotator、Transform、自定义结构）、枚举名、类名（对象引用）、class<类>、soft<类>，可以套 array<>、set<>、map<键,值>。
节点用 id（graph 结果里 # 后面那段）或这一批里 add_node 的 as 临时名引用；引脚名 exec / then / self / return 是常用别名。不指定位置时自动排。`

export const ASSET_TOOLS = [
  tool(
    'ue_blueprint',
    '读写蓝图（path 是蓝图资源路径 /Game/...；普通蓝图：Actor、组件、对象、函数库、接口）。由粗到细读：action=outline 大纲（父类、接口、变量、组件树、各张图和函数的入参出参、编译状态和上次的错误）；action=graph 读一张图（graph 是图名，不写是事件图）：默认给伪代码（沿执行线一行一句，行尾 #节点id，@id.引脚 指某个节点的输出），format=json 给节点和引脚连线（offset / limit 分页，around=节点id + hops 只取周围几跳），node=节点id 看一个节点的全部引脚。' +
      'action=node_search 按 query 查能放的节点（和编辑器右键菜单一致），结果里的 spawner 给 add_node 用。' +
      'action=edit 按操作列表修改（改完自动编译并返回每步结果、新节点 id、编译错误和对应的节点 id、受影响的子类和调用方）；dryRun=true 演练：真实执行和编译，拿到结果后取消，不留改动。复杂修改先演练。只编译用 ue_compile。' +
      '修改只在内存里（标脏），用 ue_save 保存；没保存前可以 ue_undo 撤回。类默认值和组件模板的属性也可以用 ue_get / ue_set。\n' +
      EDIT_HELP,
    {
      action: { type: 'string', enum: ['outline', 'graph', 'node_search', 'edit'] },
      path: { type: 'string' },
      graph: { type: 'string' },
      node: { type: 'string' },
      format: { type: 'string', enum: ['pseudo', 'json'] },
      around: { type: 'string' },
      hops: { type: 'number' },
      offset: { type: 'number' },
      limit: { type: 'number' },
      query: { type: 'string' },
      ops: { type: 'array', items: { type: 'object' } },
      dryRun: { type: 'boolean' },
      compile: { type: 'boolean' },
      target: TARGET,
    },
    ['action', 'path'],
    async (a, ctx) => {
      const path = a.path
      switch (a.action) {
        case 'outline':
          return out(await runOp(ctx, 'bp.outline', { path }, 120000))
        case 'graph': {
          const r = await runOp(
            ctx,
            'bp.graph',
            {
              path,
              graph: a.graph ?? '',
              node: a.node ?? '',
              format: a.format ?? 'pseudo',
              around: a.around ?? '',
              hops: a.hops,
              offset: a.offset,
              limit: a.limit,
            },
            120000,
          )
          // 伪代码直接给文字：包在 JSON 里换行全成了 \n，读起来费劲
          if (typeof r.pseudo === 'string')
            return out(
              `graph=${r.graph} kind=${r.kind} nodes=${r.total}${r.more ? '（太长截断了，用 format=json 分页看后面的）' : ''}\n${r.pseudo}`,
            )
          return out(r)
        }
        case 'node_search':
          return out(
            await runOp(ctx, 'bp.node_search', { path, graph: a.graph ?? '', query: a.query, limit: a.limit }, 120000),
          )
        case 'edit':
          if (!Array.isArray(a.ops) || !a.ops.length) return mcpText('action=edit 要给 ops（操作数组）', true)
          return out(
            await runOp(ctx, 'bp.edit', { path, ops: a.ops, dryRun: !!a.dryRun, compile: a.compile !== false }, 300000),
          )
        // 编译拆成了 ue_compile（面板据此把编译结果算进完成依据）；老会话里还按旧说明调的，指过去
        case 'compile':
          return mcpText('只编译改用 ue_compile 工具（path 参数不变）', true)
        default:
          return mcpText(`不认识的 action：${a.action}`, true)
      }
    },
  ),
  tool(
    'ue_save',
    '保存资源：把编辑器里改了没保存的包写回磁盘（packages 不给就是所有改了没保存的，ue_asset action=dirty 先看有哪些）。按「桥接与权限」的资源权限请用户确认；P4 项目先签出、新文件 add，都进默认变更列表不提交。蓝图保存前先 ue_compile 确认编译通过。',
    { packages: { type: 'array', items: { type: 'string' } }, target: TARGET },
    [],
    async (a, ctx) => {
      const res = await runOp(ctx, 'asset.save', { packages: a.packages ?? [] }, 120000)
      // 实际写回的文件交给面板记成这一轮的改动（进改动卡片和完成依据），不交给 Agent
      const saved = ((res.saved as unknown[]) ?? []).map(String).filter(Boolean)
      return { ...out(res), changed: saved }
    },
    {
      effect: 'edit',
      // 守卫判断要改哪些文件：给了 packages 就按 /Game 换成 Content 下的文件；不给（保存全部）算不出
      targets: (a, root) =>
        (Array.isArray(a.packages) ? a.packages : []).map((p) => packageToDisk(root, String(p))).filter(Boolean),
    },
  ),
  tool(
    'ue_compile',
    '编译蓝图（path 是蓝图资源路径 /Game/...），返回编译状态（ok / warnings / error）、错误和警告（带图名和节点 id）、受影响的子类和调用方。改完蓝图、保存之前用它确认通过；有错按节点 id 用 ue_blueprint edit 修，再编译。',
    { path: { type: 'string' }, target: TARGET },
    ['path'],
    async (a, ctx) => {
      const res = await runOp(ctx, 'bp.compile', { path: a.path }, 300000)
      const status = String((res.compile as { status?: string } | undefined)?.status ?? '')
      const file = packageToDisk(ctx.project.root, str(a.path))
      // 编译结论交给面板的完成依据：通过的蓝图不再要求跑项目的测试步骤，没通过时不让对话结束
      return {
        ...out(res),
        verified: { passed: status === 'ok' || status === 'warnings', name: '蓝图编译', ...(file && { files: [file] }) },
      }
    },
    { effect: 'verify' },
  ),
  tool(
    'ue_python',
    '在 UE 编辑器里执行 Python（兜底用：别的 ue_* 工具做不到的编辑器操作）。要用户在 UE 页「桥接与权限」里打开，且每次都会请用户确认；项目要启用引擎的 Python Editor Script Plugin。code 是完整脚本（import unreal），print 的内容和执行期间的日志在 output 里。能用 ue_asset、ue_blueprint、ue_get / ue_set 做的不要用它：那些有事务、撤回和编译回读，Python 没有。',
    { code: { type: 'string' }, timeoutMs: { type: 'number' }, target: TARGET },
    ['code'],
    async (a, ctx) => {
      const timeoutMs = Math.min(Math.max(Number(a.timeoutMs) || 60000, 1000), 600000)
      return out(await runOp(ctx, 'python', { code: str(a.code) }, timeoutMs))
    },
  ),
]
