/**
 * 一张表的「AI 识别表头」（用户 2026-11-23）：表格页「调整表头」里点一下，把这张表开头几行和项目现在的表头配置交给 AI，
 * 让它说这张表为什么没套上、该怎么补规则。结果用和「AI 分析表格风格」同样的 JSON（TablesDraft），
 * 只是代码块换个语言名：分析窗口右侧照样逐项勾选应用，但不当成整个项目的分析结果存进 analysis.json
 */
import type { HeaderRule } from './table-header.ts'
import { pickHeader } from './table-header-fit.ts'
import type { TableSchema } from './tables.ts'

/** 结果代码块的语言名：和整项目分析的 tables-style 分开，见文件开头 */
export const TABLE_HEADER_LANG = 'tables-header'

/** 给 AI 看的表头开头：前 ROWS 行、每行前 COLS 列，格子截短 */
const ROWS = 14
const COLS = 30
const CELL = 40
const cut = (s: string) => (s.length > CELL ? `${s.slice(0, CELL)}…` : s).replace(/[\t\n\r]/g, ' ')

export interface HeaderPromptInput {
  /** 表格的相对路径（结构文件里按它写 glob） */
  file: string
  sheet: string
  rows: string[][]
  schema: TableSchema
  /** 面板核对的结论：没套上时写哪一行对不上；套上了写用的是哪份 */
  verdict: string
  langWord: string
}

/** 表头行里引用到的通用枚举现在登记了哪些值（AI 补值时在这上面加，不整份重写） */
function headerEnums(schema: TableSchema, rules: HeaderRule[]) {
  const names = new Set(
    rules.flatMap((r) => r.rows.map((x) => x.values)).filter((v): v is string => !!v && v !== '@types'),
  )
  return Object.fromEntries([...names].map((n) => [n, (schema.enums[n]?.values ?? []).map((v) => v.name)] as const))
}

const KIND_WORD: Record<string, string> = {
  modifier: '修饰',
  side: '导出端',
  type: '类型',
  name: '字段名',
  comment: '注释',
  other: '其它',
}

/** 面板对这张表的核对结论（给 AI 的话，不翻译） */
export function headerVerdict(schema: TableSchema, file: string, sheet: string, rows: string[][]) {
  const { rule, source } = pickHeader(schema, file, sheet, rows)
  if (source.kind === 'unfit') {
    const which = source.from.kind === 'project' ? '项目表头' : '按文件指定的表头'
    const r = source.row === undefined ? undefined : source.tried.rows[source.row]
    return r
      ? `没套上：和${which}对不上，第 ${source.tried.start + source.row! + 1} 行不像「${r.label || KIND_WORD[r.kind] || r.kind}」，现在整张表按数据显示`
      : `没套上：和${which}对不上，现在整张表按数据显示`
  }
  const from =
    source.kind === 'project'
      ? '项目表头'
      : source.kind === 'sheet'
        ? '只管这个工作表的按文件指定'
        : '按通配的按文件指定'
  return rule.rows.length ? `套上了${from}（用户觉得不对，想让你再看看）` : '项目还没设表头'
}

export function buildHeaderPrompt(p: HeaderPromptInput) {
  const lines = p.rows.slice(0, ROWS).map((r, i) => `${i + 1}\t${r.slice(0, COLS).map(cut).join('\t')}`)
  const mine = p.schema.style.exceptions.filter((e) => e.glob === p.file || e.sheet === p.sheet)
  const config = {
    header: p.schema.style.header,
    exceptions: p.schema.style.exceptions.map(({ glob, sheet, header }) => ({
      glob,
      ...(sheet ? { sheet } : {}),
      header,
    })),
  }
  return [
    '你是「Agent 面板」里的表格表头助手。用户在表格页打开了下面这张表，想让面板认对它的表头（哪几行是表头、每行是什么），这样表格能结构化显示、字段名当列标题。',
    '**只看下面给的内容就够了，不要自己写脚本解析 xlsx，不要读其它文件，不要改任何文件。**',
    `## 这张表\n文件：${p.file}\n工作表：${p.sheet}（共 ${p.rows.length} 行）\n面板的核对结论：${p.verdict}\n\n开头几行（行号\\t各列）：\n${lines.join('\n')}`,
    `## 项目现在的表头配置\n面板按「只管这个工作表的按文件指定 > 按通配的按文件指定 > 项目表头」挑一份，按通配来的先核对这张表开头几行像不像（修饰行要是修饰词或这一行设的枚举值，导出端行要是 Client / Server / Public 这类写法或这一行设的枚举值，类型行要认得出类型，字段名行要是不重复的标识符、盖住大半列），一行里 80% 的格子对得上才套。\n\`\`\`json\n${JSON.stringify(config)}\n\`\`\`\n表头行引用的通用枚举现在登记的值：${JSON.stringify(headerEnums(p.schema, [p.schema.style.header, ...mine.map((e) => e.header)]))}`,
    `## 要做的
1. 先用一两句${p.langWord}说清这张表的表头是什么样（从第几行开始、每行是什么），和项目表头是不是同一种排法，没套上是哪里对不上。
2. 给出**改动最小**的规则，二选一：
   - 排法和项目表头一样，只是某一行里有没登记的值（例如导出端写了 Public）：在 enums 里给这一行设的枚举补上这些值（写**完整**的值列表，原来的也带上）；这一行还没设枚举时，在 style.header 里给它加 values（写完整的项目表头），并在 enums 里建这个枚举。
   - 排法确实不一样（行数、顺序不同，或是说明表、枚举表）：在 style.exceptions 里给它加一条按文件指定，glob 写 "${p.file}"，只管这个工作表就写 sheet "${p.sheet}"，同一类文件都这样时 glob 可以写通配；header 的 rows 按这张表实际的表头逐行写，why 写一句原因。
   项目还没设表头（上面 header 的 rows 是空的）时，直接在 style.header 里按这张表写项目表头。
   kind 只能是 modifier（optional / repeated 这类修饰）、side（Client / Server 这类导出端）、type（类型）、name（字段名，当列标题）、comment（注释）、other（其它表头行，要写 label）；start 从 0 数。
3. 只写需要改的那几项，别的（主键、类型表、扫描规则……）不要写。`,
    `## 输出格式
说明之后输出且只输出一个代码块，语言名写 ${TABLE_HEADER_LANG}，内容是 JSON（面板画在对话右侧让用户勾选应用）。用户追问、纠正后，每次回复末尾都重新输出完整的 ${TABLE_HEADER_LANG} 代码块。
\`\`\`${TABLE_HEADER_LANG}
{ "summary": "一句话结论", "style": { "exceptions": [{ "glob": "${p.file}", "sheet": "${p.sheet}", "header": { "start": 0, "rows": [{ "kind": "name" }, { "kind": "comment" }] }, "why": "说明表只有字段名和注释两行表头" }] }, "enums": {} }
\`\`\``,
  ].join('\n\n')
}
