/**
 * 步骤失败时「让 Agent 看」交给「游戏测试」角色的第一句话（定稿 11.1；发给 Agent 的提示词不翻译）。
 * 只给这次失败的事实和证据位置，怎么判断、怎么改在技能 ue-gametest-authoring 的「失败了怎么办」里。
 * 关键是先分清「游戏有问题」还是「脚本写得不对」：前者不改脚本去迁就，后者改脚本、校验、再跑。
 */
export interface AgentLookInput {
  scenario: { name: string; relativePath: string }
  /** 场景根（相对 UE 项目根） */
  root?: string
  /** 第几步（0 起） */
  index: number
  /** 显示的序号（块里的是 2.3）和步骤路径（steps.1.do.2）：录成段的场景里只有序号对不上是哪一步 */
  no?: string
  path?: string
  def?: Record<string, unknown>
  action?: string
  message?: string
  payload?: Record<string, unknown>
  evidence?: {
    dir?: string
    screenshot?: string
    widgets?: string
    log?: string
    target?: { class?: string; visibility?: string; enabled?: boolean }
    selectorError?: string
  }
}

/** payload 里对判断有用的几项（错误码、守护触发、条件每一项的结果、用到的变量），太长的截掉 */
function facts(p?: Record<string, unknown>) {
  if (!p) return []
  const pick = ['code', 'guards', 'cond', 'vars', 'invoke', 'object', 'expected', 'actual', 'fallback', 'picked']
  return pick
    .filter((k) => p[k] !== undefined)
    .map((k) => {
      const v = JSON.stringify(p[k])
      return `- ${k}: ${v.length > 600 ? `${v.slice(0, 600)}…` : v}`
    })
}

export function agentLookPrompt(x: AgentLookInput) {
  const e = x.evidence
  const scen = `${(x.root ?? '').replace(/[\\/]+$/, '')}${x.root ? '/' : ''}${x.scenario.relativePath}`
  const id = typeof x.def?.id === 'string' ? `（id ${x.def.id}）` : ''
  const files = [
    e?.screenshot && `截图 ${e.screenshot}`,
    e?.widgets && `控件快照 ${e.widgets}`,
    e?.log && `失败前后的日志 ${e.log}`,
  ].filter(Boolean)
  const selector = e?.selectorError
    ? `当时选择器找不到控件：${e.selectorError}`
    : e?.target
      ? `当时选择器找得到控件（${e.target.class ?? '?'}，${e.target.enabled === false ? '禁用' : '可用'}），控件在但这一步没成。`
      : ''
  const fact = facts(x.payload)
  return [
    '/ue-gametest-authoring',
    '',
    `GameTest 场景「${x.scenario.name}」第 ${x.no ?? x.index + 1} 步${id}${x.path && x.path.split('.').length > 2 ? `（路径 ${x.path}）` : ''}（${x.action ?? x.def?.action ?? '?'}）失败：${x.message ?? ''}`,
    `场景文件：${scen}（相对 UE 项目根）`,
    x.def ? `这一步：${JSON.stringify(x.def).slice(0, 1200)}` : '',
    files.length
      ? `失败证据（相对 UE 项目根）：${files.join('，')}`
      : '这一步没有留下失败证据（截图、日志），需要时自己 run 一次复现。',
    selector,
    ...(fact.length ? ['报告里的细节：', ...fact] : []),
    '',
    '请按技能「失败了怎么判断」来：',
    '1. 先读证据和场景文件，再读这一步涉及的界面、点击处理和相关玩法代码（Lua / 蓝图 / C++），判断是游戏有问题还是脚本写得不对。',
    '2. 脚本的问题（选择器变了、少等了异步界面、准备状态没做、弹窗没守护……）：改脚本，validate 通过后 run 验证，告诉我改了什么。',
    '3. 游戏的问题：不要改脚本去迁就它，告诉我现象、对应的代码位置和你认为的原因；能用 ue_gametest step 单步、resolve 核对选择器、look what=vars 读变量复现的，附上结果。',
    '4. 拿不准的说清楚还缺什么信息，不要猜。',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n')
}
