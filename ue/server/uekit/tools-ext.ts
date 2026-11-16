import { runOp } from '../ops.ts'
import { out, str, tool } from '../toolkit.ts'

/**
 * UEKit 扩展的 Agent 工具（面板 ADR 0067）：AssetForge 一个工具、GameTest 一个工具，同一对象的操作用 action 区分。
 * 只在项目里装了对应扩展时挂（index.ts 按磁盘上的插件过滤）。长任务（导入导出、跑场景）马上返回编号，用 job 查。
 */
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d)

export const EXT_TOOLS = [
  tool(
    'ue_forge',
    'AssetForge：用 JSON 配置（配置根在项目的文档根下：ProjectDoc/docs/AssetForge 或项目里的 docs/AssetForge，status 返回实际位置；配置是唯一真源）管理 UE 资产。action=status 看配置根、支持的资产类型和有没有作业在跑；schema 写配置前先取：给 kind 回这种配置的 JSON Schema（根节点 class、能不能有 children、文档级字段），给 class（类或结构体）回它在 props 里能写的属性和类型（filter 按名字筛，offset 翻页）；list 列配置和资产的同步状态（state 筛 never-imported / config-changed / asset-changed / pending / parse-error 或 needsImport，kind、query 筛，deep=true 深度检查）；describe 看一项（config 或 asset），含配置原文；plan 演练导入看会做哪些改动；diff 看属性差异（导入后哪些属性会变）；import 导入（configs 列表或 pending=true 导入全部待导入；先 dryRun=true）；export 把资产写回配置（assets 列表）；job 查导入导出作业的进度和结果；stop 取消作业。',
    {
      action: {
        type: 'string',
        enum: ['status', 'schema', 'list', 'describe', 'plan', 'diff', 'import', 'export', 'job', 'stop'],
      },
      config: { type: 'string', description: '配置路径（相对配置根，如 umg/UI/WBP_HUD.json）' },
      asset: { type: 'string', description: '资产路径（/Game/UI/WBP_HUD）' },
      configs: { type: 'array', items: { type: 'string' } },
      assets: { type: 'array', items: { type: 'string' } },
      pending: { type: 'boolean' },
      dryRun: { type: 'boolean' },
      state: { type: 'string' },
      kind: { type: 'string' },
      query: { type: 'string' },
      class: { type: 'string', description: 'schema：看哪个类或结构体的属性（/Script/Engine.WorldSettings、TextBlock、数据表的 rowStruct）' },
      filter: { type: 'string' },
      deep: { type: 'boolean' },
      offset: { type: 'number' },
      limit: { type: 'number' },
      id: { type: 'string', description: '作业编号（job / stop；不给取最近一个）' },
    },
    ['action'],
    async (a, ctx) => {
      const op = (name: string, args: Record<string, unknown>, timeout = 60000) => runOp(ctx, name, args, timeout)
      switch (a.action) {
        case 'status': {
          const [health, kinds] = await Promise.all([op('forge.health', {}), op('forge.kinds', {})])
          return out({ ...health, kinds: kinds.kinds })
        }
        case 'schema':
          return out(await forgeSchema(op, a))
        case 'list':
          return out(
            await op(
              'forge.entries',
              {
                state: a.state,
                kind: a.kind,
                query: a.query,
                deep: !!a.deep,
                offset: num(a.offset, 0),
                limit: Math.min(num(a.limit, 100), 300),
              },
              a.deep ? 180000 : 60000,
            ),
          )
        case 'describe':
          return out(await op('forge.describe', a.config ? { config: a.config } : { asset: a.asset }))
        case 'plan':
          return out(await op('forge.plan', { config: a.config }))
        case 'diff':
          return out(await op('forge.diff', { config: a.config }))
        case 'import':
          return out(
            await op(
              'forge.import',
              a.pending
                ? { pending: true, dryRun: !!a.dryRun }
                : { configs: a.configs ?? (a.config ? [a.config] : []), dryRun: !!a.dryRun },
            ),
          )
        case 'export':
          return out(await op('forge.export', { assets: a.assets ?? (a.asset ? [a.asset] : []) }))
        case 'job':
          return out(await op('forge.job', { id: a.id, reports: 20 }))
        case 'stop':
          return out(await op('forge.stop', { id: str(a.id) }))
        default:
          return out({ error: `不认识的 action：${str(a.action)}` })
      }
    },
  ),
  tool(
    'ue_gametest',
    'GameTest：在 PIE 或游戏进程里跑 UI / 玩法测试场景（场景根下的 JSON，schemaVersion 2，status 返回实际位置）。每步一个动作，参数以 actions 为准：click（默认真实指针：自动等控件出现、可见、可用、不动、没被挡再点，点完核对接住的是不是目标；at=[x,y] 控件内位置，button；via="code" 是旧的代码点击，点屏幕外或被挡的控件做准备时用）、drag（target+at → toTarget+toAt 或 by=[dx,dy]）、wheel（delta，target 可省）、type（默认真实按键，append 接着打，commit 回车）、key（可带 target 发给控件）、wait、assert、snapshot、screenshot……不用在 UI 操作前插 wait。步骤上的 hint 是录制记的控件说明，回放不读。选择器：`屏:路径`（屏写 WBP 名或资源路径，`屏:.` 是屏本身）、`List[3]` / `List[Id=5]` 列表条目、`A>B` 进嵌套 WBP、`A>>SButton[text=确定][0]` 或 `>>…` 找纯 Slate 控件，解析失败会报候选。action=status 看 PIE、场景根和有没有 run 在跑；actions 列动作和参数（写步骤前先看）；scenarios 列场景（query 筛）；run 跑场景（scenario）或临时步骤（steps + name），马上返回 runId；step 立即执行一步（step: {action, ...}），探路调试用；inspect 看视口某点（x,y 归一化，省略=光标处）是哪个控件接住、对应的选择器和是否核对唯一；job 看进度和最后几步；report 取完整报告（runId）；stop 取消 run。',
    {
      action: {
        type: 'string',
        enum: ['status', 'actions', 'scenarios', 'run', 'step', 'inspect', 'job', 'report', 'stop'],
      },
      scenario: { type: 'string', description: '场景文件（相对场景根，如 smoke/main-menu.json）' },
      steps: { type: 'array', items: { type: 'object' }, description: '临时步骤（不存文件），和 scenario 二选一' },
      name: { type: 'string' },
      step: { type: 'object', description: 'action=step 时的一步：{action, target?, ...参数}' },
      stepDelayMs: { type: 'number' },
      query: { type: 'string' },
      runId: { type: 'string' },
      last: { type: 'number', description: 'job 只回最后几步（默认 20）' },
      x: { type: 'number', description: 'inspect：视口内归一化横坐标 0–1（和 y 一起给，省略看光标处）' },
      y: { type: 'number' },
    },
    ['action'],
    async (a, ctx) => {
      const op = (name: string, args: Record<string, unknown> = {}, timeout = 60000) => runOp(ctx, name, args, timeout)
      switch (a.action) {
        case 'status':
          return out(await op('gt.health'))
        case 'actions':
          return out(await op('gt.actions'))
        case 'scenarios':
          return out(await op('gt.scenarios', { query: a.query, limit: 100 }))
        case 'run':
          return out(
            await op('gt.run', {
              ...(a.scenario ? { scenario: a.scenario } : { steps: a.steps ?? [], name: a.name || 'agent' }),
              ...(a.stepDelayMs !== undefined && { stepDelayMs: num(a.stepDelayMs, 0) }),
            }),
          )
        case 'step':
          return out(await op('gt.step', { step: a.step ?? {} }, 120000))
        case 'inspect':
          return out(
            await op(
              'gt.inspect',
              a.x !== undefined && a.y !== undefined ? { x: num(a.x, 0.5), y: num(a.y, 0.5) } : {},
            ),
          )
        case 'job':
          return out(await op('gt.job', { steps: num(a.last, 20) }))
        case 'report':
          return out(await op('gt.report', { runId: a.runId }))
        case 'stop':
          return out(await op('gt.stop'))
        default:
          return out({ error: `不认识的 action：${str(a.action)}` })
      }
    },
  ),
]

/**
 * ue_forge action=schema：forge.kinds 带 kind / class（AssetForge 1.1.0 起）。旧版不认这两个参数、照样回整张列表，
 * 这时说清楚要升级，不把列表当成 schema 交给 Agent
 */
async function forgeSchema(
  op: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>,
  a: Record<string, unknown>,
) {
  if (!a.kind && !a.class) return { error: '给 kind（配置的 schema）或 class（类的属性表），kind 的取值看 status 的 kinds' }
  const r = await op('forge.kinds', {
    ...(a.kind ? { kind: str(a.kind) } : {}),
    ...(a.class ? { class: str(a.class), filter: a.filter, offset: num(a.offset, 0), limit: Math.min(num(a.limit, 60), 150) } : {}),
  })
  if ((a.kind && !r.schema) || (a.class && !r.props))
    return { error: '编辑器里的 AssetForge 太旧，不会回 schema：在 UE 页「UE 插件」把 AssetForge 升到 1.1.0 以上并重新编译' }
  return r
}

/** 工具名 → 要装了哪个扩展才挂 */
export const EXT_TOOL_PLUGIN: Record<string, string> = { ue_forge: 'AssetForge', ue_gametest: 'GameTest' }
