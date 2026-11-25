import type { OpCtx } from './ops.ts'
import { t } from './util.ts'

/**
 * Agent 自己在游戏里测试前的授权卡（用户 2026-11-25）：普通对话里 Agent 第一次跑 GameTest、执行或保存 GM、开 PIE 时
 * 弹「拒绝 / 允许一次 / 本对话不再询问」，用户点了才继续；「UE 游戏内测试」工作流在定义里自带这类授权（plugin.json 的
 * grants），面板直接按允许返回、不弹卡。替掉以前的 gt-offer 钩子：那个靠模型自己去问，「提问」开关关着时问题根本到不了用户。
 * 这张卡和「提问」开关无关。查询类（look、validate、report、list…）不拦：写草稿、查一查不打扰用户；
 * ue_call / ue_set 是排查的基本工具，按「权限与设置」管，也不拦（用户 2026-11-25 按建议定）。
 * 要拦的调用登记在 SELF_TEST_OPS（接口 + 注册表），新的测试类入口往里加一行，不在工具里各写一遍
 */

/** 规则键：面板加上 plugin:ue: 前缀记进对话的放行规则（plugin.json 工作流 grants 里写全名 plugin:ue:self-test） */
export const SELF_TEST_RULE = 'self-test'

export interface SelfTestOp {
  tool: string
  actions: string[]
  /** 卡片上写「要做什么」 */
  what: (a: Record<string, unknown>) => string
}

const s = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v))

export const SELF_TEST_OPS: SelfTestOp[] = [
  {
    tool: 'ue_gametest',
    actions: ['run', 'step'],
    what: (a) => {
      if (a.action === 'step') return t('执行一步 GameTest：{step}', { step: s(a.step).slice(0, 200) })
      if (a.tag) return t('跑标签为 {tag} 的 GameTest 脚本', { tag: s(a.tag) })
      if (Array.isArray(a.scenarios) && a.scenarios.length)
        return t('跑 GameTest 脚本：{list}', { list: a.scenarios.map(s).join('、') })
      if (a.scenario) return t('跑 GameTest 脚本：{name}', { name: s(a.scenario) })
      return t('跑临时 GameTest 步骤（{n} 步）', { n: Array.isArray(a.steps) ? a.steps.length : 0 })
    },
  },
  {
    tool: 'ue_gm',
    actions: ['run', 'macro', 'save'],
    what: (a) =>
      a.action === 'save'
        ? t('保存 GM 到团队共用的 GM 库：{name}', { name: s((a.def as { name?: unknown } | undefined)?.name) })
        : a.action === 'macro'
          ? t('执行 GM 宏：{name}', { name: s(a.name) })
          : t('执行 GM：{name}', {
              name: `${s(a.name)} ${Array.isArray(a.args) ? a.args.map(s).join(' ') : s(a.args)}`.trim(),
            }),
  },
  { tool: 'ue_editor', actions: ['pie_start'], what: () => t('在编辑器里开 PIE') },
]

const opOf = (tool: string, a: Record<string, unknown>) =>
  SELF_TEST_OPS.find((o) => o.tool === tool && o.actions.includes(String(a.action ?? '')))

/** 这次调用要不要先过授权卡 */
export const needsSelfTest = (tool: string, a: Record<string, unknown>) =>
  !!opOf(tool, a) && !(tool === 'ue_gm' && a.action === 'save' && a.dryRun === true)

/**
 * 过授权卡：允许返回空串，拒绝返回给 Agent 的说明（工具结果，原样给 Agent 看：说清不要绕路）。
 * 不在对话里的调用（没有 confirm）按拒绝：没人能点卡
 */
export async function selfTestGate(tool: string, a: Record<string, unknown>, ctx: OpCtx): Promise<string> {
  const op = opOf(tool, a)
  if (!op || !needsSelfTest(tool, a) || ctx.actor.kind !== 'agent') return ''
  if (!ctx.confirm) return '这一步要用户先同意 Agent 在游戏里测试，但这次调用不在对话里，没法弹出授权卡。'
  const r = await ctx.confirm({
    title: t('让 Agent 自己用 GameTest / GM 在游戏里测试'),
    detail: `${op.what(a)}\n${t('会在编辑器或 PIE 里操作界面、执行 GM，改的是运行中的游戏状态，不改资源和代码。')}`,
    rule: SELF_TEST_RULE,
    ruleLabel: t('自己写和跑游戏内测试（GameTest / GM）'),
  })
  if (r.allow) return ''
  return `用户没同意在游戏里测试${r.message ? `（${r.message}）` : ''}：验证到编译通过为止，不要换别的工具（ue_lua、ue_console、ue_call）绕过去做同样的事；回复里说一句「要在游戏里验证的话，回我『写 GameTest』」。`
}
