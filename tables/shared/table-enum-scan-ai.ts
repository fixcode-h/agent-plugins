/**
 * AI 总结枚举扫描规则（用户 2026-11-14：指定一个枚举示例，AI 分析后总结出可复用的扫描规则，之后一键扫描）。
 * AI 只写规则（声明式的参数），不写要执行的代码：扫描每次都由面板按规则在本机跑，不调模型、结果确定。
 * 流程：页面在项目里开一个分析对话 → CLI 读示例（代码文件直接读，表格用 table.enum_scan_peek）→
 * 用 table.enum_scan_try 试跑到和示例对上 → 最后一条回复里给出 enum-scan 代码块 → 页面打开规则弹窗给用户看、保存。
 */
import { z } from 'zod'
import { EnumScan, ScanFrom, ScanRename, SCAN_AUTO } from './table-enum-scan.ts'

/** 回复里规则代码块的语言名 */
export const ENUM_SCAN_LANG = 'enum-scan'

export interface ScanExample {
  /** 示例文件：相对项目目录或绝对路径 */
  file: string
  /** 表格的页签 */
  sheet?: string
  /** 示例里的一个枚举名 */
  enumName?: string
  /** 用户补充的说明（比如「只要 E 开头的」「值写在 id 字段」） */
  note?: string
  /** 「让 AI 调整」时现在的规则和上次扫描的提醒 / 错误 */
  current?: EnumScan
  problems?: string[]
}

/** 发给 CLI 的第一句话（提示词不翻译；回复语言的要求由服务端 withPromptLangRules 拼上） */
export function buildEnumScanPrompt(ex: ScanExample) {
  const lines = [
    '帮我总结一条「枚举扫描规则」：Agent 面板的表格插件以后按这条规则在本机一键扫出项目里的枚举定义（不再调用模型），用于配置表里枚举列的下拉和检查。',
    '',
    '## 示例',
    `- 文件：${ex.file}${ex.sheet ? `（页签 ${ex.sheet}）` : ''}`,
    ...(ex.enumName ? [`- 其中一个枚举：${ex.enumName}`] : []),
    ...(ex.note?.trim() ? [`- 用户说明：${ex.note.trim()}`] : []),
    ...(ex.current
      ? [
          '',
          '## 现在的规则（在它基础上调整）',
          '```json',
          JSON.stringify(ex.current, null, 2),
          '```',
          ...(ex.problems?.length ? ['上次扫描的提醒 / 错误：', ...ex.problems.slice(0, 10).map((p) => `- ${p}`)] : []),
        ]
      : []),
    '',
    '## 怎么做',
    '1. 先看示例：代码文件（.h / .cpp / .lua / .cs 等）直接读；xlsx / csv 用面板动作 table.enum_scan_peek 看那个页签的前几十行（带 Excel 列号）。',
    '   同目录、同类文件里可能还有别的枚举定义，看一两个确认写法是通用的，规则要能扫出它们全部，不要只针对示例那一个。',
    '2. 选一种写法（from.kind）并填参数，用面板动作 table.enum_scan_try 试跑：它返回扫出了哪些枚举、示例枚举的成员和提醒。',
    '   对不上就改参数再试，直到示例枚举的成员、值都对，并且没有扫进不是枚举的东西。',
    '3. 不要写要执行的脚本：只有内置写法确实表达不了时才用 kind=command，并在说明里讲清楚为什么、脚本要用户自己放进项目。',
    '',
    '## 规则格式',
    '写法（from.kind）：',
    '- block：表格里，枚举名只写在每组第一行，下面几行枚举名那列空着都属于它。字段 file、sheet、start（Excel 行号，可不写）、enumCol、nameCol、valueCol、descCol（列写 Excel 列号 A/B/C 或表头字段名）',
    '- rows：表格里，每一行都有枚举名和成员名。字段同 block',
    '- sheets：表格里，每个页签是一个枚举。字段 file、sheet（页签通配）、nameFrom（sheet/file）、start、nameCol、valueCol、descCol',
    '- cpp：C++ 源码。字段 files（相对项目目录的通配，逗号分隔，** 跨目录，尽量只指到放枚举的目录）、exclude、onlyUenum、skipHidden、skip（跳过成员的正则，默认跳过 _MAX / Count 这类哨兵）、desc（meta=UMETA 的 DisplayName/ToolTip，comment=注释，none）',
    '- lua：Lua 源码。字段 files、exclude、names（枚举变量名的正则，按最后一段比；空的是「键都是名字、值都是数字或字符串」的表）、container（枚举都在一个总表下时写总表名）、valueField / descField（成员值是表时取哪个字段）、skip',
    '- regex：其它文本。字段 files、exclude、block（带命名组 name 和 body 的正则，多行模式）、member（在 body 里找成员，带命名组 name，可选 value、desc）、skip',
    '- command：自定义命令（尽量别用）。字段 command、cwd、timeoutSec、files',
    `rename：{ stripPrefix, addPrefix, map }——表格里写的枚举名和定义处不一样时用（例如定义叫 EColor、表格里写 Color 就 stripPrefix "E"）。`,
    `auto：${SCAN_AUTO.join(' / ')}（open 打开表格页时看源文件变没变，watch 后台盯着源文件，off 只手动）；表格类一般 open，代码类一般 open。`,
    '',
    '## 交回',
    `最后一条回复先用两三句话说明规则怎么认枚举、试跑扫出多少个，然后给一个 \`\`\`${ENUM_SCAN_LANG} 代码块，里面是 JSON：`,
    '{ "name": "规则的名字（几个字）", "from": { "kind": "…", … }, "rename": { … }, "auto": "open" }',
    '不需要 id。用户会在面板里看到这条规则和试跑结果，确认后才保存。',
  ]
  return lines.join('\n')
}

/** AI 交回的规则（不带 id，保存时由页面给） */
export const EnumScanDraft = z.object({
  name: z.string().trim().max(60).default(''),
  from: ScanFrom,
  rename: ScanRename.default(() => ScanRename.parse({})),
  auto: z.enum(SCAN_AUTO).default('open'),
})
export type EnumScanDraft = z.infer<typeof EnumScanDraft>

/** 从最后一条回复里取规则：优先 enum-scan 代码块，没有时退到普通 JSON（调用方给 extractJson） */
export function enumScanOf(
  reply: string,
  fallback: (text: string) => { json?: unknown; error?: string },
): { draft?: EnumScanDraft; error?: string } {
  const blocks = [...reply.matchAll(new RegExp('```' + ENUM_SCAN_LANG + '[^\\n]*\\n([\\s\\S]*?)```', 'g'))]
  let json: unknown
  const raw = blocks.at(-1)?.[1]
  if (raw !== undefined) {
    try {
      json = JSON.parse(raw)
    } catch (e) {
      return { error: `JSON 解析失败：${(e as Error).message}` }
    }
  } else {
    const fb = fallback(reply)
    if (fb.error) return { error: `没有找到 \`\`\`${ENUM_SCAN_LANG} 代码块` }
    json = fb.json
  }
  const got = EnumScanDraft.safeParse(json)
  if (!got.success)
    return {
      error: got.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(根)'}：${i.message}`)
        .join('；'),
    }
  return { draft: got.data }
}

/** 规则交给试跑前补上 id（试跑不在乎 id） */
export const withId = (d: EnumScanDraft, id: string): EnumScan => EnumScan.parse({ ...d, id })
