/**
 * GameTest 页「AI 整理」交给 Agent 的话（发给 Agent 的提示词不翻译）。在 AI 分析对话里跑：
 * Agent 不改场景文件，只在回复里给一个 ```gametest-tidy 代码块（以原步骤为基准的改动列表，格式见 server/uekit/gt-tidy-plan.ts），
 * 用户在对话右侧的应用面板里逐条勾选后，面板才写回场景（原录制自动备份）。
 */
export interface TidySource {
  hash: string
  name: string
  steps: Record<string, unknown>[]
  scenarioPath: string
  /** 场景根（绝对路径） */
  root: string
  /** 场景相对场景根的路径 */
  rel: string
  projectRoot: string
}

const join = (root: string, rel: string) => `${root.replace(/[\\/]+$/, '')}/${rel.replace(/^[\\/]+/, '')}`

/** 每一步的录制线索：截图（绝对路径，让 Agent 直接看图）、OCR 认出的字、点完打开的界面 */
function clues(s: TidySource) {
  const lines: string[] = []
  s.steps.forEach((step, i) => {
    const h = step.hint && typeof step.hint === 'object' ? (step.hint as Record<string, unknown>) : undefined
    if (!h) return
    const parts = [
      typeof h.shot === 'string' && h.shot ? `截图 ${join(s.projectRoot, h.shot)}` : '',
      typeof h.screen === 'string' && h.screen ? `整屏 ${join(s.projectRoot, h.screen)}` : '',
      typeof h.ocr === 'string' && h.ocr ? `图上的字「${h.ocr}」` : '',
      Array.isArray(h.opened) && h.opened.length ? `点完打开 ${h.opened.join('、')}` : '',
    ].filter(Boolean)
    if (parts.length) lines.push(`- 第 ${i + 1} 步：${parts.join('；')}`)
  })
  return lines
}

export function tidyPrompt(s: TidySource, need: string) {
  const shots = clues(s)
  return [
    `请整理这份 GameTest 录制，提炼成真正的测试步骤：${s.scenarioPath}（场景「${s.name}」，共 ${s.steps.length} 步）`,
    need.trim() ? `这份测试要验证的是：${need.trim()}` : '',
    '',
    '录制是真人操作直接录下来的，常见的问题：',
    '- 同一个入口按钮点了两次（第一次没点开又点了一次）、误点空白处、打开又马上关掉：回放时会把界面开了又关，删掉多余的。',
    '- 修饰键 press / release（LeftAlt、Ctrl、Shift）包着点击：多半是切窗口、截图时误按的，游戏逻辑不靠它就删掉这一对；游戏确实要按住它才保留。',
    '- 短按被录成了相邻的 key press + key release：合成一步 key phase=tap；按住很久才松开的保留时长（写法以 ue_gametest action=actions 里 key 的字段为准）。',
    '- 固定时长的 wait seconds：回放的 click / type / drag 自己会等控件可见可点，UI 操作前的固定等待删掉；要等某个界面出现或消失的，改成 wait until=widget / widgetGone 加 target（下面「点完打开」给出了界面类名）。',
    '- input.cursor + 鼠标键的坐标点击点在 UI 上：能确定是哪个控件的，改成 click target=选择器（拿不准用 ue_gametest action=inspect 看，或者原样留着），点在游戏画面上的不动。',
    '- mark（录制时的说明）想表达的是检查点的，改成 assert；只是备注的写进前后步骤的说明。',
    '',
    shots.length ? '录制时的线索（截图里红框是被点的控件、十字是按下的位置；先看图再判断这一步在做什么）：' : '',
    ...shots,
    shots.length ? '' : '',
    '做法：',
    '1. 先读场景文件原文，再用 ue_gametest action=actions 看实际可用的动作和字段，只用列出来的（GameTest 读到不认识的字段会直接报错）；编辑器没开时照场景里已有的写法来。',
    '2. 按项目实际代码判断步骤合不合理：从截图、hint 里的界面资源（asset）、选择器找到被点控件所在的 WBP，再找它绑定的点击处理（蓝图事件、Lua 里的 OnClicked / 按钮回调、C++），看这一步实际触发什么、前后步骤的依赖对不对（例如点「领取」前要先满足什么条件、某个界面是异步打开要等、某个按钮其实是切页签）。发现的问题写进 review（只提示用户，不自动应用），能改的写进 changes。',
    '3. 选择器、hint 原样保留，不要自己编选择器；拿不准的步骤不改，在 review 里说明。',
    '4. 给每一步写 notes：一句中文，说这一步在测试里做什么（「打开桌面摆件第 2 页」，不要只写「点击桌面摆件2」）。',
    '5. 不要改场景文件。最后在回复里给出一个 gametest-tidy 代码块（步骤号都从 1 数、指原场景；一步只能被一条改动碰）：',
    '```gametest-tidy',
    '{',
    '  "kind": "gametest-tidy",',
    `  "scenario": { "root": ${JSON.stringify(s.root)}, "path": ${JSON.stringify(s.rel)}, "hash": "${s.hash}" },`,
    '  "summary": "一句话说整理了什么",',
    '  "review": [ { "step": 5, "level": "warn", "text": "按 WBP_Shop 的 OnBuyClicked，余额不够时不会打开确认框，回放前要先加钱" } ],',
    '  "changes": [',
    '    { "what": "第 2 步重复点了商店入口", "op": "delete", "steps": [2] },',
    '    { "what": "固定等待改成等商店界面出现", "op": "replace", "steps": [3], "with": [ { "action": "wait", "until": "widget", "target": "WBP_Shop" } ] },',
    '    { "what": "开头先用 GM 加钱", "op": "insert", "after": 0, "with": [ { "action": "gm", "command": "..." } ] },',
    '    { "what": "加载慢，放宽等待", "op": "edit", "step": 6, "set": { "timeoutMs": 10000 } }',
    '  ],',
    '  "notes": { "1": "打开商店", "4": "买第一件商品" }',
    '}',
    '```',
    '   op：delete 删掉 steps；replace 把 steps 换成 with；insert 在 after 后面插入 with（0 是最前面）；edit 改 step 的字段（值写 null 是删掉这个字段，换动作用 replace）。scenario 一行照上面原样抄回。',
    '6. 代码块前面用几句话说明整理了什么、哪几步拿不准。用户在这个窗口右侧的应用面板里逐条勾选后才写回场景文件（原录制会自动备份）。',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n')
}
