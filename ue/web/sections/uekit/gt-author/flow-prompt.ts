/**
 * 「整理成流程」（定稿 9.7）在 AI 整理提示词里加的一节：服务端规则（server/uekit/gt-flowify）认出的模式作为建议交给 Agent，
 * 再讲清 wrap / guard / param 三种改动怎么写（格式见 server/uekit/gt-tidy-flow.ts）。发给 Agent 的提示词不翻译。
 */
export interface FlowHintLite {
  rule: string
  what: string
  steps: number[]
  changes: Record<string, unknown>[]
}

export function flowLines(hints: FlowHintLite[] | undefined) {
  const list = hints ?? []
  return [
    '整理成流程：录制是一条直线，回放时界面不一定和录制时一模一样。能用流程写稳的就改：',
    '- 连着重复的同一操作（连点下一页、连按 E 跳对话）→ wrap 成 loop，until 写「下一步的目标出现」，max 留余量；次数确实固定的用 times。',
    '- 中途弹出又马上关掉的界面（公告、奖励、引导、确认框）→ guard：出现就关，不出现不卡；别的脚本里也会弹的写 "global": true 进全局守护。',
    '- 几步只在某个界面在 / 不在时才做 → wrap 成 if（cond 用统一条件）；同一个 skipIf 写在连续几步上的合成一个 if。',
    '- 和场景根里现成脚本（登录、进副本……）一样的一段 → replace 成 { "action": "call", "script": "相对场景根的路径" }。',
    '- 输入的账号、名字、数量这类固定值 → param 提成参数（跑的时候能换、被 call 时能传）。',
    '- 判断「功能做没做对」的检查点（金币变了、任务完成）优先读代码变量（ue_gametest action=look what=vars / props，或对象调用读字段），不要只看界面文字。',
    list.length
      ? '面板的规则先认出了这些（只是建议：照项目代码判断，条件不对就改，不合适就不用，每一条都要写进 changes 才会生效）：'
      : '',
    ...list.map((h, i) => `${i + 1}. [${h.rule}] ${h.what}\n   ${JSON.stringify(h.changes)}`),
  ]
}

/** 改动格式说明里 wrap / guard / param 的那几行 */
export const FLOW_OP_EXAMPLES = [
  '    { "what": "连点下一页改成循环", "op": "wrap", "steps": [7], "block": { "action": "loop", "until": { "target": "WBP_Shop:Btn_Buy", "visible": true }, "max": 20 } },',
  '    { "what": "公告弹窗改成守护", "op": "guard", "steps": [9], "guard": { "name": "关公告", "when": { "target": "WBP_Notice:.", "onScreen": true } } },',
  '    { "what": "账号提成参数", "op": "param", "name": "account", "default": "qa_01", "uses": [ { "step": 1, "field": "text" } ] },',
]

export const FLOW_OP_HELP =
  '   wrap 把连续的 steps 原样包进 loop（放进 do，要写 max 或 times）/ if（放进 then，要写 cond）/ group，block 里不写 do / then；' +
  'guard 把 steps 从主流程拿掉变成守护（do 不写就用这几步，global: true 写进全局守护）；param 把 uses 列的字段改成 $name、顶层 params 加一项。' +
  'edit 可以和 wrap / guard 叠在同一步上，param 不占步骤；用到 wrap / guard / param 时场景会升到 schemaVersion 3。'
