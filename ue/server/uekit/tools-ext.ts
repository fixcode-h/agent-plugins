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
    'AssetForge：用 JSON 配置（配置根在项目的文档根下：ProjectDoc/docs/AssetForge 或项目里的 docs/AssetForge，status 返回实际位置；配置是唯一真源）管理 UE 资产。action=status 看配置根、支持的资产类型和有没有作业在跑；list 列配置和资产的同步状态（state 筛 never-imported / config-changed / asset-changed / pending / parse-error 或 needsImport，kind、query 筛，deep=true 深度检查）；describe 看一项（config 或 asset），含配置原文；plan 演练导入看会做哪些改动；diff 看属性差异（导入后哪些属性会变）；import 导入（configs 列表或 pending=true 导入全部待导入；先 dryRun=true）；export 把资产写回配置（assets 列表）；job 查导入导出作业的进度和结果；stop 取消作业。',
    {
      action: {
        type: 'string',
        enum: ['status', 'list', 'describe', 'plan', 'diff', 'import', 'export', 'job', 'stop'],
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
    'GameTest：在 PIE 或游戏进程里跑 UI / 玩法测试场景（场景根下的 JSON，status 返回实际位置，每步一个动作：click、type、key、wait、assert、snapshot、screenshot……）。action=status 看 PIE 状态、场景根和有没有 run 在跑；actions 列出能用的动作和参数（写步骤前先看）；scenarios 列场景（query 筛）；run 跑一个场景（scenario 相对场景根）或临时步骤（steps + name），马上返回 runId；step 立即执行一步（step: {action, ...}），探路和调试用；job 看当前或最近一次 run 的进度和最后几步；report 取一次 run 的完整报告（runId）；stop 取消正在跑的 run。',
    {
      action: { type: 'string', enum: ['status', 'actions', 'scenarios', 'run', 'step', 'job', 'report', 'stop'] },
      scenario: { type: 'string', description: '场景文件（相对场景根，如 smoke/main-menu.json）' },
      steps: { type: 'array', items: { type: 'object' }, description: '临时步骤（不存文件），和 scenario 二选一' },
      name: { type: 'string' },
      step: { type: 'object', description: 'action=step 时的一步：{action, target?, ...参数}' },
      stepDelayMs: { type: 'number' },
      query: { type: 'string' },
      runId: { type: 'string' },
      last: { type: 'number', description: 'job 只回最后几步（默认 20）' },
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

/** 工具名 → 要装了哪个扩展才挂 */
export const EXT_TOOL_PLUGIN: Record<string, string> = { ue_forge: 'AssetForge', ue_gametest: 'GameTest' }
