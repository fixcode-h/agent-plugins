import type { McpResult } from '../../../sdk/server.ts'
import { runOp, type OpCtx } from '../ops.ts'
import { out, str, tool } from '../toolkit.ts'
import { GT_TOOL } from './gt-tool.ts'
import { configBaseline } from './forge-baseline.ts'
import { forgeVerdict } from './forge-verdict.ts'

/**
 * UEKit 扩展的 Agent 工具（面板 ADR 0067）：AssetForge 一个工具、GameTest 一个工具，同一对象的操作用 action 区分。
 * 只在项目里装了对应扩展时挂（index.ts 按磁盘上的插件过滤）。长任务（导入导出、跑场景）马上返回编号，用 job 查。
 */
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d)

/** 有结论时把它交给面板的完成依据（不交给 Agent） */
const withVerdict = (r: McpResult, verified: McpResult['verified']) => (verified ? { ...r, verified } : r)

export const EXT_TOOLS = [
  tool(
    'ue_forge',
    'AssetForge：用 JSON 配置（配置根在项目的文档根下：ProjectDoc/docs/AssetForge 或项目里的 docs/AssetForge，status 返回实际位置；配置是唯一真源）管理 UE 资产。action=status 看配置根、支持的资产类型和有没有作业在跑；schema 写配置前先取：给 kind 回这种配置的 JSON Schema（根节点 class、能不能有 children、文档级字段），给 class（类或结构体）回它在 props 里能写的属性和类型（filter 按名字筛，offset 翻页）；list 列配置和资产的同步状态（默认只列有配置的，unmanaged=true 连还没配置的资产一起列；state 筛 never-imported / config-changed / asset-changed / pending / parse-error 或 needsImport，kind、query 筛，deep=true 深度检查）；describe 看一项（config 或 asset），含配置原文；plan 演练导入看会做哪些改动；diff 看属性差异（默认比资产：导入后哪些属性会变；against=commit 和 git / P4 里上次提交的配置比，看这次改了配置的哪些属性）；import 导入（configs 列表或 pending=true 导入全部待导入；先 dryRun=true）；export 把资产写回配置（assets 列表）；job 查导入导出作业的进度和结果（正式导入跑完全部成功算进完成依据）；stop 取消作业。用 ue_set / ue_asset / ue_blueprint 改了纳管的资产时结果里会提醒：要保留就改配置再导入，或 export 写回配置。',
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
      unmanaged: { type: 'boolean', description: 'list：连还没配置的资产一起列（默认 false）' },
      against: { type: 'string', enum: ['asset', 'commit'], description: 'diff：和谁比（默认 asset）' },
      dryRun: { type: 'boolean' },
      state: { type: 'string' },
      kind: { type: 'string' },
      query: { type: 'string' },
      class: {
        type: 'string',
        description: 'schema：看哪个类或结构体的属性（/Script/Engine.WorldSettings、TextBlock、数据表的 rowStruct）',
      },
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
                unmanaged: a.unmanaged === true,
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
          return out(await forgeDiff(op, a, ctx))
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
        case 'job': {
          const job = await op('forge.job', { id: a.id, reports: 20 })
          return withVerdict(out(job), forgeVerdict(job))
        }
        case 'stop':
          return out(await op('forge.stop', { id: str(a.id) }))
        default:
          return out({ error: `不认识的 action：${str(a.action)}` })
      }
    },
    // 正式导入跑完算进完成依据（forge-verdict.ts）；只读的 action 不会被守卫挡，verified 只在有结论时给
    { effect: 'verify' },
  ),
  GT_TOOL,
]

/**
 * ue_forge action=schema：forge.kinds 带 kind / class（AssetForge 1.1.0 起）。旧版不认这两个参数、照样回整张列表，
 * 这时说清楚要升级，不把列表当成 schema 交给 Agent
 */
async function forgeSchema(
  op: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>,
  a: Record<string, unknown>,
) {
  if (!a.kind && !a.class)
    return { error: '给 kind（配置的 schema）或 class（类的属性表），kind 的取值看 status 的 kinds' }
  const r = await op('forge.kinds', {
    ...(a.kind ? { kind: str(a.kind) } : {}),
    ...(a.class
      ? { class: str(a.class), filter: a.filter, offset: num(a.offset, 0), limit: Math.min(num(a.limit, 60), 150) }
      : {}),
  })
  if ((a.kind && !r.schema) || (a.class && !r.props))
    return {
      error: '编辑器里的 AssetForge 太旧，不会回 schema：在 UE 页「UE 插件」把 AssetForge 升到 1.1.0 以上并重新编译',
    }
  return r
}

/** 工具名 → 要装了哪个扩展才挂 */
export const EXT_TOOL_PLUGIN: Record<string, string> = { ue_forge: 'AssetForge', ue_gametest: 'GameTest' }

type Op = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>

/** ue_forge action=diff：against=commit 时先取 git / P4 里上次提交的配置当基线（和页面「对比：上次提交的配置」同一份） */
async function forgeDiff(op: Op, a: Record<string, unknown>, ctx: OpCtx) {
  if (!a.config) return { error: '给 config（相对配置根的配置路径）' }
  if (a.against !== 'commit') return op('forge.diff', { config: a.config })
  const d = await op('forge.describe', { config: a.config })
  const file = (d.entry as { configPath?: string } | undefined)?.configPath
  if (!file) return { error: `找不到配置 ${str(a.config)}` }
  const base = await configBaseline(ctx.project, file)
  if ('error' in base) return base
  return op('forge.diff', { config: a.config, baselineText: base.text })
}
