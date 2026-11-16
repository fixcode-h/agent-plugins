/**
 * GameTest 页「AI 整理」交给 Agent 的话（发给 Agent 的提示词不翻译）。
 * Agent 只写整理稿（产物目录里，不在场景根），不改场景文件：用户在页面上看过步骤差异点保存，面板才写回并备份原录制。
 */
export function tidyPrompt(a: { scenarioPath: string; draftPath: string; source: string; need: string }) {
  return [
    `请整理这份 GameTest 录制，提炼成真正的测试步骤：${a.scenarioPath}`,
    a.need.trim() ? `这份测试要验证的是：${a.need.trim()}` : '',
    '',
    '录制是真人操作直接录下来的，常见的问题：',
    '- 同一个入口按钮点了两次（第一次没点开又点了一次）：回放时两次点击会把面板开了又关，只留一次。',
    '- 修饰键 press / release（LeftAlt、Ctrl、Shift）包着点击：多半是切窗口、截图时误按的，游戏逻辑不靠它就删掉这一对；游戏确实要按住它（例如按住 Alt 显示鼠标、Shift 多选）才保留 press … release，不要合成 tap。',
    '- 短按被录成了相邻的 key press + key release、中间没别的步骤：合成一步 key phase=tap；按住很久才松开的（例如按住 W 走路）保留时长，写法以 actions 里 key 的字段为准（有 holdMs 就写 phase=tap + holdMs，没有就保留 press / release 中间加 wait seconds）。',
    '- 固定时长的 wait seconds：回放的 click / type / drag 自己会等控件可见可点，UI 操作前的固定等待删掉；要等某个界面出现或消失才能继续的，改成 wait until=widget / widgetGone 加 target。',
    '- input.cursor + 鼠标键的坐标点击点在 UI 上：能确定是哪个控件的，改成 click target=选择器（选择器拿不准用 ue_gametest action=inspect 看，或者照原样留着），点在游戏画面上的不动。',
    '- mark（录制时的说明）想表达的是检查点的，改成 assert（可见、文字、数量……）；只是备注的写进前后步骤的 note。',
    '- 误点、点了又撤回、和测试目的无关的来回操作删掉；连续几步做的是一件事的保持顺序不动。',
    '',
    '做法：',
    '1. 先读场景文件原文，再用 ue_gametest action=actions 看实际可用的动作和每个动作的字段，只用列出来的字段（GameTest 读到不认识的字段会直接报错）；编辑器没开时照场景里已有的写法来。',
    '2. 选择器、hint 原样保留，不要自己编选择器；拿不准就别改那一步。',
    '3. 每一步都写 note：一句中文，说这一步在测试里做什么（例如「打开 GM 面板」「确认背包里出现新道具」），不要只复述动作名。',
    `4. 不要改场景文件本身。把整理结果写成一个 JSON 文件：${a.draftPath}，格式：`,
    '```json',
    '{',
    '  "kind": "gametest-tidy",',
    `  "source": "${a.source}",`,
    '  "summary": "一句话说整理了什么",',
    '  "changes": [',
    '    { "what": "第 4 步重复点了 GM 入口，删掉", "from": [4], "to": [] },',
    '    { "what": "LeftAlt 按下/松开是误按，删掉", "from": [3, 5], "to": [] }',
    '  ],',
    '  "scenario": { "name": "原名", "steps": [ { "action": "...", "note": "..." } ] }',
    '}',
    '```',
    '   changes 里的步骤号从 1 数，from 是原场景的步骤、to 是新场景的步骤；scenario 是整份新场景（只写 name、_note、tags、stepDelayMs、steps 这些，其余面板保存时从原文件带上）。',
    '5. 写完告诉我改了哪些、有哪几步拿不准。我在 GameTest 页「AI 整理」里看步骤差异，确认后才写回场景文件（原录制会自动备份）。',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n')
}
