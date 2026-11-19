import type { McpResult } from '../../sdk/server.ts'
import { diskToPackage, packageToDisk } from './asset-query.ts'
import { compileBeforeSave } from './bp-check/compile-before-save.ts'
import { noteCompile, noteSaved, packageName } from './bp-check/state.ts'
import { BATCH_HINT, BATCH_PROPS, jobResult, runBatch } from './batch/run.ts'
import { isBatch } from './batch/targets.ts'
import { resumeJob } from './long-ops.ts'
import { runOp, type OpCtx } from './ops.ts'
import { out, str, TARGET, tool } from './toolkit.ts'
import { mcpText } from './util.ts'

const taskOf = (ctx: OpCtx) => (ctx.actor.kind === 'agent' ? ctx.actor.taskId : '')
/** 桥接的编译结果：ok、warnings 算通过 */
const compileOk = (res: Record<string, unknown>) => {
  const status = String((res.compile as { status?: string } | undefined)?.status ?? '')
  return status === 'ok' || status === 'warnings'
}
/** 保存的磁盘文件换回包名；不在 Content 里的（不该有）跳过 */
function toPackage(file: string, root: string) {
  try {
    return [diskToPackage(file.replace(/\\/g, '/').replace(/\.(uasset|umap)$/i, ''), root)]
  } catch {
    return []
  }
}

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
      validate: 'path，或 paths（多个资源一次查，提交前检查用；只回条数和前几条，完整结果写 report 文件）',
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
      'ue_compile（单独的工具）': 'path：编译并给出通过没有，保存前用它确认',
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

/** 长操作交给 UE 当作业跑：20 秒内做完照常返回，没做完回作业号（long-ops.ts） */
const JOB = { job: true }

/** 长操作的说明：几个工具共用 */
export const JOB_HINT =
  '耗时长的操作（编译、改名、删除、批量校验、蓝图修改）在 UE 里作为作业跑：20 秒内做完照常返回；没做完返回 job（作业号），带 job 再调同一个工具接着等，不要重新发起。'

/** ue_asset 的通用动作；不是这里管的 action 返回 undefined，交回 tools.ts 里 DataTable 和保存那几个 */
export async function assetAction(a: Record<string, unknown>, ctx: OpCtx): Promise<McpResult | undefined> {
  const need = (...keys: string[]) => {
    const miss = keys.filter((k) => !a[k])
    return miss.length ? mcpText(`action=${a.action} 要给 ${miss.join('、')}`, true) : undefined
  }
  // 带 job：接着等之前没做完的作业（改名、删除、批量校验……），不管 action
  if (a.job) return jobResult(await resumeJob(ctx.project.id, str(a.job)), 'ue_asset', a.action, ctx)
  // 批量（paths / items / select）；validate 的 paths 是它自己的老用法，照旧
  if (isBatch(a) && a.action !== 'validate') return runBatch('ue_asset', a, ctx)
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
      // UELink 2.4 起 paths 一次查多个（提交前检查）：只回条数和前几条，完整结果在 report 文件里
      if (Array.isArray(a.paths) && a.paths.length)
        return out(await runOp(ctx, 'asset.validate', { paths: a.paths.map(String) }, 600000, JOB))
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
        out(await runOp(ctx, `asset.${a.action}`, { path: a.path, to: a.to, dryRun: !!a.dryRun }, 300000, JOB))
      )
    case 'delete':
      return (
        need('path') ??
        out(await runOp(ctx, 'asset.delete', { path: a.path, force: !!a.force, dryRun: !!a.dryRun }, 300000, JOB))
      )
    default:
      return undefined
  }
}

const EDIT_HELP = `ops 是操作数组，整批在一个编辑器事务里执行，任一步失败整批取消。每个操作 {op, ...}：
成员：add_variable {name, type, default?, category?, instanceEditable?, replicated?, exposeOnSpawn?}；set_variable {name, type?, rename?, default?, …同上}；remove_variable {name}；add_function {name, inputs?:[{name,type}], outputs?:[{name,type}], pure?}；remove_function {name}。
类设置：add_interface / remove_interface {interface}；reparent {parent}；set_default {prop, value}（类默认值，prop 同 ue_get）。
组件：add_component {name, class, parent?}；remove_component {name}；set_component {name, prop, value}。
一条改多个：set_variable / remove_variable / remove_function / set_component / remove_component 的 name 可给数组，每项可写通配符（* ?，不分大小写）；组件另可 componentClass（组件类，含子类），不写 name 就是这个类的全部组件；remove_node 的 node 可给 id 数组。展开后在同一个事务里逐个做，任一个失败整批取消；结果带 count 和 each。
改属性（set_component / set_default）：props {属性路径: 值} 一次改多个属性；where 是期望的当前值（用 props 时写 {属性路径: 期望值}），对不上的跳过（skipped）；结果带 prev 和 value，演练也有，可以先看改前改后。
没有才加：add_variable / add_function / add_component / add_interface 加 ifMissing: true，已经有了就跳过，同一组操作可以重跑。
节点（graph 不写是事件图）：add_node {graph?, as?, spawner 或 kind, x?, y?, comment?, pins?:{引脚名:默认值}}，kind 有 call {function:"类名.函数名"}、get / set {variable}、branch、sequence、cast {class}、self、event {name:"BeginPlay"}、custom_event {name, inputs?}、macro {macro:"ForEachLoop"}，其余先 node_search 拿 spawner；remove_node {node}；set_pin {pin:"节点.引脚", value}；connect / disconnect {from:"节点.引脚", to:"节点.引脚"}（disconnect 不写 to 断开全部连线）；move {node, x, y}；comment {graph?, text, nodes?:[节点]}。
类型：bool、int、int64、float、byte、name、string、text、结构体名（Vector、Transform、自定义结构）、枚举名、类名（对象引用）、class<类>、soft<类>，可套 array<> / set<> / map<键,值>。
节点用 id（graph 结果里 # 后那段）或本批 add_node 的 as 名引用；引脚别名 exec / then / self / return；不给位置自动排。`

/** ue_compile 的批量：汇总里全部 ok / warnings 才算通过，交给面板的完成依据 */
async function compileBatch(a: Record<string, unknown>, ctx: OpCtx) {
  const r = a.job
    ? await jobResult(await resumeJob(ctx.project.id, str(a.job)), 'ue_compile', undefined, ctx)
    : await runBatch('ue_compile', a, ctx)
  if (r.isError) return r
  let sum: { status?: string; items?: number; ok?: number; lines?: string[] } = {}
  try {
    sum = JSON.parse(String((r.content?.[0] as { text?: string } | undefined)?.text ?? '{}'))
  } catch {
    return r
  }
  // 还在编：不给完成依据
  if (!sum.status || sum.status === 'running' || sum.status === 'queued') return r
  return { ...r, verified: { passed: sum.status === 'done' && sum.ok === sum.items, name: '蓝图编译' } }
}

export const ASSET_TOOLS = [
  tool(
    'ue_blueprint',
    '读写蓝图（path 是蓝图资源路径 /Game/...；普通蓝图：Actor、组件、对象、函数库、接口）。由粗到细读：action=outline 大纲（父类、接口、变量、组件树、各张图和函数的入参出参、编译状态和上次的错误）；action=graph 读一张图（graph 是图名，不写是事件图）：默认给伪代码（沿执行线一行一句，行尾 #节点id，@id.引脚 指某个节点的输出），format=json 给节点和引脚连线（offset / limit 分页，around=节点id + hops 只取周围几跳），node=节点id 看一个节点的全部引脚。' +
      'action=node_search 按 query 查能放的节点，spawner 给 add_node 用。' +
      'action=edit 按操作列表修改（改完自动编译，返回每步结果、新节点 id、编译错误及节点 id、受影响的子类）；dryRun=true 演练（真实执行和编译后取消，不留改动），复杂修改先演练。' +
      '修改只在内存里（标脏），ue_save 保存，保存前可 ue_undo 撤回；类默认值用 ue_get / ue_set。' +
      '20 秒没做完回 job，带 job 再调接着等。' +
      BATCH_HINT +
      ' compile="end" 整批改完再编译。' +
      '\nedit 的 ops 是 [{op, ...}]，op 有：add_variable / set_variable / remove_variable、add_function / remove_function、add_interface / remove_interface、reparent、set_default、add_component / set_component / remove_component、add_node / remove_node / set_pin / connect / disconnect / move / comment。' +
      '一条可以改多个：name 给数组或通配符（组件可按 componentClass 选），set_component / set_default 用 props 一次改多个属性，where 只改当前值对得上的，add_* 加 ifMissing 已有就跳过。每个 op 的参数和类型写法先 action=help 看一次。',
    {
      action: { type: 'string', enum: ['outline', 'graph', 'node_search', 'edit', 'help'] },
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
      // true / false，或 "end"（批量时整批改完再统一编译）
      compile: {},
      job: { type: 'string' },
      ...BATCH_PROPS,
      target: TARGET,
    },
    ['action'],
    async (a, ctx) => {
      const path = a.path
      if (a.job) return jobResult(await resumeJob(ctx.project.id, str(a.job)), 'ue_blueprint', a.action, ctx)
      if (a.action === 'help') return out(EDIT_HELP)
      if (isBatch(a)) return runBatch('ue_blueprint', a, ctx)
      if (!path) return mcpText('要给 path（蓝图资源路径），多个用 paths / select', true)
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
          const compile = a.compile !== false
          const r = await runOp(ctx, 'bp.edit', { path, ops: a.ops, dryRun: !!a.dryRun, compile }, 300000, JOB)
          // 写后编译钩子据此跳过已经编过的蓝图（bp-check/state.ts）；演练不留改动，不记。
          // 转成作业（长操作）时这里拿不到编译结果，按「没确认过」记，保存后钩子会再编一次
          if (!a.dryRun) noteCompile(taskOf(ctx), packageName(path), compile ? compileOk(r) : undefined)
          return out(r)
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
    '保存资源：把编辑器里改了没保存的包写回磁盘（packages 不给就是所有改了没保存的，ue_asset action=dirty 先看有哪些）。按「权限与设置」的资源权限请用户确认；P4 项目先签出、新文件 add，都进默认变更列表不提交。蓝图保存前先 ue_compile 确认编译通过；或者 compile=true 让它先把要保存的蓝图一起编一遍，有没编过的就整批不保存（改完蓝图直接 ue_save compile=true 一步到位）。',
    { packages: { type: 'array', items: { type: 'string' } }, compile: { type: 'boolean' }, target: TARGET },
    [],
    async (a, ctx) => {
      const packages = Array.isArray(a.packages) ? a.packages.map(String) : []
      if (a.compile) {
        const gate = await compileBeforeSave(ctx, packages)
        if (!gate.ok) return mcpText(gate.message ?? '编译没通过，没有保存', true)
      }
      const res = await runOp(ctx, 'asset.save', { packages }, 120000)
      // 实际写回的文件交给面板记成这一轮的改动（进改动卡片和完成依据），不交给 Agent
      const saved = ((res.saved as unknown[]) ?? []).map(String).filter(Boolean)
      // 交给写后编译钩子（bp-check/hook.ts）：保存之后编译其中的蓝图，没通过的把错误补给模型
      noteSaved(
        taskOf(ctx),
        ctx.project.id,
        saved.flatMap((f) => toPackage(f, ctx.project.root)),
      )
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
    '编译蓝图（path 是蓝图资源路径 /Game/...），返回编译状态（ok / warnings / error）、错误和警告（带图名和节点 id）、受影响的子类和调用方。改完蓝图、保存之前用它确认通过；有错按节点 id 用 ue_blueprint edit 修，再编译。' +
      '大蓝图编译久：20 秒内没编完返回 job，带 path 和 job 再调一次接着等。一次编多个蓝图用 paths / select（结果按蓝图汇总，全部通过才算通过）。',
    { path: { type: 'string' }, job: { type: 'string' }, ...BATCH_PROPS, target: TARGET },
    [],
    async (a, ctx) => {
      if (isBatch(a) || (a.job && !a.path)) return compileBatch(a, ctx)
      if (!a.path) return mcpText('要给 path（蓝图资源路径），多个用 paths / select', true)
      const res = a.job
        ? await resumeJob(ctx.project.id, str(a.job))
        : await runOp(ctx, 'bp.compile', { path: a.path }, 300000, JOB)
      // 还在编：不给完成依据，等带 job 再调拿到结果
      if (res.job && !res.compile) return out(res)
      const status = String((res.compile as { status?: string } | undefined)?.status ?? '')
      noteCompile(taskOf(ctx), packageName(a.path), compileOk(res))
      const file = packageToDisk(ctx.project.root, str(a.path))
      // 编译结论交给面板的完成依据：通过的蓝图不再要求跑项目的测试步骤，没通过时不让对话结束
      return {
        ...out(res),
        verified: {
          passed: status === 'ok' || status === 'warnings',
          name: '蓝图编译',
          ...(file && { files: [file] }),
        },
      }
    },
    { effect: 'verify' },
  ),
  tool(
    'ue_python',
    '在 UE 编辑器里执行 Python（兜底用：别的 ue_* 工具做不到的编辑器操作）。要用户在 UE 页「权限与设置」里打开，且每次都会请用户确认；项目要启用引擎的 Python Editor Script Plugin。code 是完整脚本（import unreal），print 的内容和执行期间的日志在 output 里。能用 ue_asset、ue_blueprint、ue_get / ue_set 做的不要用它：那些有事务、撤回和编译回读，Python 没有。',
    { code: { type: 'string' }, timeoutMs: { type: 'number' }, target: TARGET },
    ['code'],
    async (a, ctx) => {
      const timeoutMs = Math.min(Math.max(Number(a.timeoutMs) || 60000, 1000), 600000)
      return out(await runOp(ctx, 'python', { code: str(a.code) }, timeoutMs))
    },
  ),
]
