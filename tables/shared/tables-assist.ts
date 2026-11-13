/**
 * AI 分析表格风格：给 CLI 一份挑出来的几张表的清单，它一张一张用 table.sample 读表头和前几行，
 * 让它自己从读到的表头总结出项目的表头配置（一个「行」的数组）、主键、列表分隔符、基础类型、例外文件、枚举、列的引用 / 范围，
 * 以及结构体这类类型的字段和存储样式（照格子实际的写法，用户 2026-11-13 要求 AI 分析时自己调整存储样式），输出一个 JSON。
 * 页面上逐项勾选后才写进项目的表格结构文件；表格文件本身不动。
 */
import { z } from 'zod'
import { promptLangWord } from './prompt-lang.ts'
import type { AssistMessage } from './assist.ts'
import { SHEET_ROLES } from './sheet-header.ts'
import { HeaderRule } from './table-header.ts'
import { upgradeRule } from './table-schema-upgrade.ts'
import { TableColumn, TableEnum, type TableSchema } from './tables.ts'
import { MapFormat, TableType, TypeFormats } from './table-types.ts'

/** CLI 输出的 JSON；每一部分都可以没有 */
export const TablesDraft = z.object({
  summary: z.string().max(4000).default(''),
  style: z
    .object({
      /** 项目的表头：一个「行」的数组，每项对应表头的一行（和结构文件同一个格式） */
      header: HeaderRule.optional(),
      key: z.string().max(100).optional(),
      listSep: z.string().min(1).max(4).optional(),
      primitives: z.array(z.string().max(40)).max(80).optional(),
      arrayMarks: z.array(z.string().trim().max(40)).max(20).optional(),
      exceptions: z
        .array(
          z.object({
            glob: z.string().min(1).max(300),
            sheet: z.string().max(200).optional(),
            header: HeaderRule,
            why: z.string().max(300).optional(),
          }),
        )
        .max(50)
        .optional(),
    })
    .default({}),
  enums: z.record(z.string().max(200), TableEnum).default({}),
  columns: z.record(z.string().max(700), TableColumn).default({}),
  /** 类型表：结构体、映射这类格子的字段和存储样式（照表里实际的写法） */
  types: z.record(z.string().max(100), TableType).default({}),
  /** 数组、映射在格子里的写法；只写看得出的几项 */
  formats: z
    .object({
      field: z.string().min(1).max(8).optional(),
      listStore: TypeFormats.shape.listStore.unwrap().partial().optional(),
      mapStore: MapFormat.partial().optional(),
    })
    .optional(),
})
export type TablesDraft = z.infer<typeof TablesDraft>

/** 任务提示词的上限（shared/schema.ts 里任务的 prompt） */
const PROMPT_MAX = 20000

export function buildTablesPrompt(sample: string, convo: string, langWord: string) {
  return [
    '你是「Agent 面板」里的表格分析助手，正在帮用户总结**这个项目的游戏配置表的风格**，结果用来让网页上的表格能结构化显示和修改（固定表头、枚举下拉、引用检查）。',
    '面板从项目里挑了下面几张表（不用看全部表）。**一张一张来**：每张表用面板动作 `table.sample`（app_do，参数 `{ "path": 表格路径 }`）读它的表头和前几行，先写一两行这张表的结论（表头从第几行开始、每行是什么、主键、类型名、看到的枚举值），再看下一张；全部看完再汇总。**不要自己写脚本解析 xlsx，不要读其它文件，不要改任何文件。**',
    `## 要看的表\n${sample}`,
    `## 要总结的
- style.header：**这个项目的表头配置**。表头是一个数组 rows，数组里每一项对应表格表头的一行，从第 start 行（从 0 数）开始按顺序往下排。
  要从你读到的表里自己总结：每张表开头几行哪些是表头、各是什么，取大多数表都一样的那种排法。每项写：
  kind：这一行是什么，只能是 modifier（optional / repeated 这类修饰）、side（Client / Server / Editor 这类导出端）、type（uint32、string、枚举类型名）、
  name（字段名，当列标题）、comment（中文注释）、other（其它表头行，例如分组标题、默认值）；
  label：这一行的名字，用表里或项目里的叫法（例如「导出标记」「默认值」），kind 是 other 时一定要写；
  values（可选）：这一行只能填固定几个值时，写 enums 里的枚举名（例如修饰行写 "Modifier"）；类型行写 "@types"（基础类型 + 枚举名）。
  面板完全按这份配置显示表格，不会再按内容猜，所以行数和顺序要和表里的一致。
- style.exceptions：表头和上面不一样的表（例如某个目录的枚举表只有两行表头）按文件指定：glob 用相对路径的通配（例如 "Config/Enum/*.xlsx"），
  只管某个工作表时写 sheet，header 格式同上，why 写一句原因。
- style.arrayMarks：修饰行里表示「这一列是数组」的值（例如 repeated、list）。
- style.key：主键字段名（通常是 ID / Id）。
- style.listSep：repeated 列一格里多个值的分隔符（例如 ; 或 |）。
- style.primitives：类型行里出现的基础类型名（数字、字符串、布尔），其余大驼峰的类型名当枚举或结构。
- enums：样本里看得出取值范围的枚举类型：键是类型名，values 是 [{ "name": 填进表格的字, "value": 数值（看不出就不写）, "desc": 说明（看不出就不写） }]。
  只列样本里确实出现过的值，不要编；值太多（超过 200）或看起来是自由文本的不要当枚举。
- types：**类型表**。类型行里出现的结构体、坐标、颜色、奖励这类「一格里有好几个字段」的类型（例如 FVector、Reward、TArray<FReward> 里的 FReward），
  按表里格子**实际的写法**总结：键是类型名，值是 { "kind": "struct", "fields": [{ "name": 字段名, "type": 字段类型 }], "store": 存储样式模板 }。
  store 用 {字段名} 占位，其余照抄格子里的字，例如格子写 1#2#3 就是 "{X}#{Y}#{Z}"，写 (X=1,Y=2,Z=3) 就是 "(X={X},Y={Y},Z={Z})"；
  字段名看不出时用 UE 的叫法（FVector 是 X Y Z、FRotator 是 Pitch Yaw Roll、FColor 是 R G B A）。也可以写别名
  { "kind": "alias", "of": "TArray<int32>" } 和带范围的基础类型 { "kind": "int", "min": 0, "max": 100 }。只写样本里确实看到的类型。
- formats：数组、映射在格子里的写法，只写看得出的：listStore（{ "open": 左括号, "close": 右括号, "inner": 数组套数组时里层的分隔符 }）、
  mapStore（{ "open", "close", "sep": 两对之间的分隔符, "entry": 一对的模板，{K} 是键、{V} 是值，例如 "{K}:{V}" }）、field（结构体字段默认的分隔符）。
- columns：看得出的引用和范围，键是「相对路径#*#字段名」，值是 { "ref": "被引用表的相对路径#字段名", "min": 数, "max": 数, "allow": ["-1"], "note": 说明 }。
  只写有把握的；没有就给空对象。`,
    convo ? `## 对话\n${convo}` : '',
    `## 输出格式
先用两三句${langWord}说明看到的风格。然后输出且只输出一个 \`\`\`json 代码块：
\`\`\`json
{ "summary": "一句话总结", "style": { "header": { "start": 0, "rows": [{ "kind": "modifier", "label": "修饰", "values": "Modifier" }, { "kind": "side", "label": "导出端" }, { "kind": "type", "label": "类型", "values": "@types" }, { "kind": "name", "label": "字段名" }, { "kind": "comment", "label": "注释" }] }, "key": "ID", "listSep": ";", "primitives": ["uint32", "int32", "string", "bytes", "bool", "float"], "arrayMarks": ["repeated"], "exceptions": [{ "glob": "Config/Enum/*.xlsx", "header": { "start": 0, "rows": [{ "kind": "name" }, { "kind": "comment" }] }, "why": "枚举表只有字段名和注释" }] }, "enums": {}, "columns": {}, "types": { "FVector": { "kind": "struct", "fields": [{ "name": "X", "type": "float" }, { "name": "Y", "type": "float" }, { "name": "Z", "type": "float" }], "store": "{X}#{Y}#{Z}" } }, "formats": { "mapStore": { "sep": ";", "entry": "{K}:{V}" } } }
\`\`\``,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** AI 交回的表格风格：页面上逐项勾选后写进结构文件 */
export type TablesProposal = { kind: 'tables'; draft: TablesDraft }

/** 配置助手的入口（shared/assist.ts 调）：样本由页面先读好放在 subject.sample */
export function buildTablesBody(subject: Record<string, string>, messages: AssistMessage[]) {
  const convo = messages
    .map((m) => `### ${m.role === 'user' ? '用户' : '你（上一轮的回复）'}\n${m.text.trim()}`)
    .join('\n\n')
  // 清单很短；多轮对话越来越长时只留最近的，整段提示词要在任务提示词上限以内
  const sample = (subject.sample ?? '').slice(0, 3000)
  const room = PROMPT_MAX - 500 - buildTablesPrompt(sample, '', promptLangWord()).length
  return buildTablesPrompt(sample, convo.length > room ? `…\n${convo.slice(-room)}` : convo, promptLangWord())
}

/**
 * AI 交回的表头先理一遍再交给 zod：不认识的 kind（default、export……）不整份作废，改成 other，原来的词留作这行的名字；
 * 还按旧格式（roles + labels、按种类的 roleEnums、几套 headers）写的也认，换成新格式（AI 的输出不是存下的数据，宽松些）
 */
function fixRule(h: unknown, roleEnums: Record<string, unknown>): unknown {
  const up = upgradeRule(h, roleEnums)
  if (!up || typeof up !== 'object' || !Array.isArray((up as { rows?: unknown }).rows)) return up
  const rows = (up as { rows: unknown[] }).rows.map((r) => {
    if (!r || typeof r !== 'object') return r
    const { kind, label } = r as { kind?: unknown; label?: unknown }
    if (typeof kind === 'string' && (SHEET_ROLES as readonly string[]).includes(kind)) return r
    return { ...r, kind: 'other', ...(!label && typeof kind === 'string' ? { label: kind.slice(0, 20) } : {}) }
  })
  return { ...up, rows }
}

function normalizeDraft(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  // 类型一个个查：写坏的一个丢掉，不让整份分析作废
  const types = (raw as { types?: unknown }).types
  const json =
    types && typeof types === 'object'
      ? {
          ...raw,
          types: Object.fromEntries(Object.entries(types).filter(([, v]) => TableType.safeParse(v).success)),
        }
      : raw
  const style = (json as { style?: Record<string, unknown> }).style
  if (!style || typeof style !== 'object') return json
  const s: Record<string, unknown> = { ...style }
  const roleEnums = s.roleEnums && typeof s.roleEnums === 'object' ? (s.roleEnums as Record<string, unknown>) : {}
  // 旧格式的几套表头：取第一套（最常见的）；其余的没有通配，交给 AI 写成 exceptions
  if (!s.header && Array.isArray(s.headers)) s.header = s.headers[0]
  delete s.headers
  delete s.roleEnums
  if (s.header) s.header = fixRule(s.header, roleEnums)
  if (Array.isArray(s.exceptions))
    s.exceptions = s.exceptions.map((e) =>
      e && typeof e === 'object' ? { ...e, header: fixRule((e as { header?: unknown }).header, roleEnums) } : e,
    )
  return { ...json, style: s }
}

export function resolveTablesProposal(json: unknown): { proposal?: TablesProposal; error?: string } {
  const p = TablesDraft.safeParse(normalizeDraft(json))
  if (!p.success) return { error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  const style = { ...p.data.style }
  if (style.header && !style.header.rows.length) delete style.header
  return { proposal: { kind: 'tables', draft: { ...p.data, style } } }
}

/** 分析结果里能单独勾选的每一项（id 给 applyTablesDraft 用） */
export function draftItemIds(d: TablesDraft): string[] {
  const s = d.style
  return [
    ...(s.header?.rows.length ? ['header'] : []),
    ...(s.key ? ['key'] : []),
    ...(s.listSep ? ['listSep'] : []),
    ...(s.primitives?.length ? ['primitives'] : []),
    ...(s.arrayMarks?.length ? ['arrayMarks'] : []),
    ...(s.exceptions ?? []).map((_, i) => `ex:${i}`),
    ...Object.keys(d.enums).map((k) => `enum:${k}`),
    ...Object.keys(d.columns).map((k) => `col:${k}`),
    ...Object.keys(d.types).map((k) => `type:${k}`),
    ...(d.formats && Object.values(d.formats).some(Boolean) ? ['formats'] : []),
  ]
}

/**
 * 把勾上的几项并进结构文件：表头、主键这类单值直接换；按文件指定的按 glob + 工作表换掉同一条；枚举、列按名字整项换
 * （手写的从枚举表取值的设置保留）。没勾的不动，记下分析时间
 */
export function applyTablesDraft(schema: TableSchema, d: TablesDraft, picked: Set<string>, at: string): TableSchema {
  const s = d.style
  const style = { ...schema.style }
  if (picked.has('header') && s.header?.rows.length) style.header = s.header
  if (picked.has('key') && s.key) style.key = s.key
  if (picked.has('listSep') && s.listSep) style.listSep = s.listSep
  if (picked.has('primitives') && s.primitives) style.primitives = s.primitives
  if (picked.has('arrayMarks') && s.arrayMarks?.length) style.arrayMarks = s.arrayMarks
  const ex = (s.exceptions ?? []).filter((_, i) => picked.has(`ex:${i}`))
  if (ex.length)
    style.exceptions = [
      ...style.exceptions.filter((e) => !ex.some((x) => x.glob === e.glob && x.sheet === e.sheet)),
      ...ex.map(({ glob, sheet, header }) => ({ glob, ...(sheet ? { sheet } : {}), header })),
    ]
  const enums = { ...schema.enums }
  for (const [k, e] of Object.entries(d.enums))
    if (picked.has(`enum:${k}`)) enums[k] = { ...e, ...(enums[k]?.source ? { source: enums[k].source } : {}) }
  const columns = { ...schema.columns }
  for (const [k, c] of Object.entries(d.columns)) if (picked.has(`col:${k}`)) columns[k] = c
  const types = { ...schema.types }
  for (const [k, ty] of Object.entries(d.types)) if (picked.has(`type:${k}`)) types[k] = ty
  if (picked.has('formats') && d.formats) {
    const f = style.formats
    style.formats = TypeFormats.parse({
      ...f,
      ...(d.formats.field ? { field: d.formats.field } : {}),
      listStore: { ...f.listStore, ...d.formats.listStore },
      mapStore: { ...f.mapStore, ...d.formats.mapStore },
    })
  }
  return { ...schema, style, enums, columns, types, analyzedAt: at }
}
