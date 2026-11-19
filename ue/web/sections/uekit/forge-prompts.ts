/**
 * AssetForge 页交给 Agent 的话（发给 Agent 的提示词不翻译）：新建一份配置、改一份已有配置。
 * 两种都要求先取 schema / 属性表再写、写完演练、不导入：导入要人在页面上看过预览再点。
 */
/** 按段写（设计稿 4.3）和 include（4.3.4）：一句话说清写法，Agent 大配置只读写要改的那一段 */
const SECTION_NOTE = [
  '配置写法：顶层按段排，顺序是 header（$schema、//、kind、schemaVersion、revision、asset、parent 和其他小字段）→ styles → root → 各 kind 的其余段（UMG 是 animations，见 schema 的 x-forge.sections）；配置很长时用 ue_forge action=describe config=<配置> section=<段> 只读这一段，改好后同样带 section 和 text（"animations": [ … ] 这样带字段名的这一段）只写回这一段。',
  'include：某一段（头字段不行）或 children 里的某个节点可以写成 { "include": "<相对这份文件的路径>" }，片段文件顶层写 "fragment": "node"（内容放 node 字段，一个节点或节点数组）或 "fragment": "<段名>"（内容放同名字段），不写 kind；原来是 include 的地方改它指向的片段文件，不要展开回主文件。',
].join('\n')

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
    '',
    SECTION_NOTE,
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
    '',
    SECTION_NOTE,
  ].join('\n')
}
