import path from 'node:path'
import type { UeProject } from '../types.ts'
import { readConfig, scriptFile, storeDir, SCRIPT_NAME } from './config.ts'
import { current } from './scan.ts'

/**
 * 交给 Agent 写 / 改扫描脚本的提示词（设计稿 4.2：第一次让 AI 读 GM 文件总结出扫描脚本，以后都由脚本扫）。
 * 放进对话输入框给用户看过再发，不直接替用户发出去。提示词不翻译（发给 Agent 的）
 */
const CONTRACT = `脚本约定（ESM，Node 22，只用 node: 内置模块，不要装依赖）：
\`\`\`js
// files: [{ path: 项目里的是相对项目根的路径，项目外的（全局路径）是绝对路径，都用 / 分隔, text: 文件全文 }]，面板读好了传进来，脚本不要自己读文件、不要联网、不要改文件
export default function scan(files) {
  return [
    {
      name: 'AddItem',            // GM 名，全项目唯一
      group: '背包',               // 分组（文件里的分组写法；没有就用文件名）
      desc: '给当前角色加道具',     // 说明（取注释）
      file: 'Content/Script/GM/GMBag.lua', line: 24, // 定义所在文件和行号（从 1 数）
      call: 'GM.AddItem({itemId}, {count})', // 怎么调用：{参数名} 换成参数值，{args} 是全部参数；GM 挂在表上、要用冒号调用都写在这里
      params: [
        // type 用 integer / number / string / boolean，其它（table 等）写原类型，面板按 Lua 表达式原样填
        // default 是 Lua 字面量文字；table 是参数关联的配置表和列：<表名>.<列名>，例如 Item.Id（从注释或参数名能看出来时才写）
        { name: 'itemId', type: 'integer', desc: '道具 Id', table: 'Item.Id' },
        { name: 'count', type: 'integer', default: '1' },
      ],
    },
  ]
}
\`\`\``

function common(p: UeProject, files: string[]) {
  const rel = (f: string) => path.relative(p.root, f).replaceAll('\\', '/')
  return `GM 文件（相对项目根 ${p.root}）：
${files.map((f) => `- ${f}`).join('\n')}

扫描脚本的位置：${rel(path.join(storeDir(p), SCRIPT_NAME))}

${CONTRACT}

要求：
- 先通读这些 GM 文件，总结出写法规律：GM 挂在哪个表或类上、分组怎么写、说明写在哪种注释里（---、--[[ ]]、@param 等）、参数怎么声明、调用时用点还是冒号。
- 按规律写脚本，用正则或逐行解析都行，不要把具体的 GM 名写死在脚本里：以后新加的 GM 要能直接扫出来。
- 参数关联表格：注释里写了表和列（例如 ---@param itemId integer Item.Id）就照写；没写但参数名明显对应某张配置表（itemId → Item 表的 Id）时，可以用 table.list / table.schema 动作核实那张表和列真的存在再写上。拿不准就不写。
- 写好后用 ue_gm action=list source=lua 看扫描结果（这一步只读本机文件，不需要 UE 在运行），对照 GM 文件核对条数、参数和行号，有错就改脚本再看，直到对上。`
}

export async function scriptPrompt(p: UeProject, mode: 'create' | 'fix', note = '') {
  const cfg = await readConfig(p)
  const scan = await current(p)
  const files = scan.files.length ? scan.files : cfg.files
  if (mode === 'create')
    return `请读项目里的 Lua GM 文件，总结出 GM 的写法，写一个扫描脚本，以后面板用它一次性扫出全部 GM（面板 UE 页 GM 页里显示、执行，参数能关联配置表）。

${common(p, files)}`
  const sample = scan.items
    .slice(0, 5)
    .map((x) => `- ${x.name}（${x.file}:${x.line}）params: ${x.params.map((q) => q.name).join(', ') || '无'}`)
    .join('\n')
  return `面板的 Lua GM 扫描脚本扫得不对，请改一下。${note ? `\n\n哪里不对：${note}` : ''}

现在的脚本：${path.relative(p.root, scriptFile(p)).replaceAll('\\', '/')}
现在的扫描结果：${scan.error ? `出错：${scan.error}` : `${scan.items.length} 条${scan.warnings.length ? `，有 ${scan.warnings.length} 条警告：${scan.warnings.slice(0, 5).join('；')}` : ''}`}
${sample ? `前几条：\n${sample}\n` : ''}
${common(p, files)}`
}
