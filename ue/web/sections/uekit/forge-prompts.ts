/**
 * AssetForge 页交给 Agent 的话（发给 Agent 的提示词不翻译）：新建一份配置、改一份已有配置。
 * 两种都要求先取 schema / 属性表再写、写完演练、不导入：导入要人在页面上看过预览再点。
 */
const rootOf = (configRoot: string) => configRoot.replace(/\\/g, '/').replace(/\/$/, '')

export function aiPrompt(a: { kind: string; asset: string; config: string; configRoot: string; need: string }) {
  return [
    `请新建一份 AssetForge 配置（kind = ${a.kind}），目标资产 ${a.asset}。`,
    `配置文件写到 ${rootOf(a.configRoot)}/${a.config}（配置根下的 ${a.config}，目录已经建好）。`,
    `需求：${a.need.trim()}`,
    '',
    '做法：',
    `1. 先用 ue_forge action=schema kind=${a.kind} 取这种配置的 JSON Schema；props 里要写的属性用 ue_forge action=schema class=<类> 取属性表照着写，不要猜属性名和取值格式。`,
    `2. 写完用 ue_forge action=plan config=${a.config} 演练，有错误诊断就改到没有为止。`,
    '3. 不要导入（不要 action=import），我在 AssetForge 页看过预览再导入。',
  ].join('\n')
}

export function aiEditPrompt(a: { kind?: string; asset?: string; config: string; configRoot: string; need: string }) {
  return [
    `请修改 AssetForge 配置 ${rootOf(a.configRoot)}/${a.config}（配置根下的 ${a.config}${a.kind ? `，kind = ${a.kind}` : ''}${a.asset ? `，目标资产 ${a.asset}` : ''}）。`,
    `要改的：${a.need.trim()}`,
    '',
    '做法：',
    `1. 先读这份配置原文；新加的属性用 ue_forge action=schema class=<类> 取属性表照着写${a.kind ? `，结构不确定时用 ue_forge action=schema kind=${a.kind} 看形状` : ''}，不要猜属性名和取值格式。`,
    '2. 只改需要改的地方，其余保持原样（包括注释和顺序），revision 加 1。',
    `3. 改完用 ue_forge action=plan config=${a.config} 演练，有错误诊断就改到没有为止；把这次会让资产变的地方告诉我。`,
    '4. 不要导入（不要 action=import），我在 AssetForge 页看过差异和计划再导入。',
  ].join('\n')
}
