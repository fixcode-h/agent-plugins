/**
 * GameTest 页「让 Agent 写」交给 Agent 的第一句话（发给 Agent 的提示词不翻译）。
 * 做法全在技能 ue-gametest-authoring 里，这里只给这次的要求和位置，免得两处写的不一样。
 */
export interface AgentWriteInput {
  /** 要测什么（用户写的一句话） */
  need: string
  /** 参考：提交号、需求文档、相关代码路径（可空） */
  refs: string
  /** 场景根（绝对路径） */
  root: string
  /** 放在场景根下哪个文件夹（相对，空是根） */
  dir: string
}

export function agentWritePrompt(x: AgentWriteInput) {
  const dir = x.dir.replace(/^\/+|\/+$/g, '')
  const where = `${x.root.replace(/[\\/]+$/, '')}/${dir ? `${dir}/` : ''}`
  return [
    '/ue-gametest-authoring',
    '',
    `给这个 UE 项目写一份 GameTest 回放测试：${x.need.trim()}`,
    x.refs.trim() ? `参考：${x.refs.trim()}` : '',
    '',
    `- 脚本写在 ${where} 下（v3 格式，每步有 id、中文 title（很短的节点名称）和 note（详细说明）），tags 里加 "agent" 标明是 Agent 写的。`,
    '- 按技能的流程来：先读相关代码，用 ue_gametest action=look 的 what=vars / widgets / api 查能用的变量、控件和接口；缺准备状态用的接口就在项目接口文件夹里加（Lua 或 C++），说明加了什么。',
    '- 写完先 validate，有错改到没有；编辑器开着时 run，看 report，失败时判断是功能 bug 还是脚本问题。',
    '- 不要让我去录制或手动点界面。通过后告诉我脚本路径、验证了什么、跑了几次，并问我要不要放进 regression/。',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n')
}
