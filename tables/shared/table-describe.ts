/**
 * 给 Agent 看的列结构（table.schema 动作）：一张表每一列的字段名、类型、是不是数组、枚举能填哪些值、
 * 引用哪张表的哪个字段、取值范围和校验规则，以及表头有几行、数据从第几行开始。
 * 和表格页标红、保存前检查用的是同一份 columnInfos / columnOptions，Agent 照着填就不会被检查拦下。
 */
import type { SheetData } from './files.ts'
import type { TableSchema } from './tables.ts'
import { columnInfos, columnOptions, headerOf, type ColKind } from './table-struct.ts'
import { colLetters } from './table-agent.ts'

/** 一个枚举最多列这么多个值，再多的给个数（让 Agent 用 table.query 去查枚举表） */
const ENUM_VALUES = 80

export interface ColumnDesc {
  /** 列字母（A、B……） */
  col: string
  field: string
  /** 类型名（结构文件里改过的优先，否则是表头类型行的字） */
  type: string
  /** 按什么检查：int / uint / float / bool / string / enum / other（other 不查类型） */
  kind: ColKind
  /** 数组列：一格里写几个值，用 sep 分开 */
  list?: { sep: string }
  enum?: { name: string; values: string[]; more?: number }
  /** 引用：值必须是那张表那一列里有的（「相对路径#字段名」或「相对路径#工作表#字段名」） */
  ref?: string
  min?: number
  max?: number
  /** 除范围、枚举之外还允许的值 */
  allow?: string[]
  /** 正则（整格要符合） */
  pattern?: string
  required?: boolean
  requiredWhen?: { field: string; values: string[] }
  note?: string
  /** 表头里这一列每一行的字（修饰、导出端、注释……），空的不列 */
  head?: Record<string, string>
}

export interface SheetDesc {
  sheet: string
  /** 表头：从第几行开始（Excel 行号）、每一行是什么 */
  header: { row: number; role: string }[]
  /** 数据从第几行开始（Excel 行号） */
  dataFrom: number
  /** 数据有几行（不含末尾的空行） */
  rows: number
  /** 主键字段（这张表里有这一列时） */
  key: string
  columns: ColumnDesc[]
}

export function describeSheet(
  schema: TableSchema,
  file: string,
  sheet: SheetData,
  sheetsOf: (file: string) => SheetData[] | undefined,
): SheetDesc {
  const header = headerOf(schema, file, sheet)
  const width = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0)
  const infos = columnInfos(schema, sheet.rows, header, file, sheet.name, width)
  const { enumOpts } = columnOptions(schema, infos, sheetsOf)
  const from = header.start + header.roles.length
  let end = sheet.rows.length
  while (end > from && !(sheet.rows[end - 1] ?? []).some((x) => x)) end--
  const columns: ColumnDesc[] = []
  for (const i of infos) {
    // 备注列（没有字段名）不给：Agent 不该往里填
    if (i.remark || (!i.field && !i.type)) continue
    const opts = i.enumName ? (enumOpts.get(i.enumName) ?? []) : []
    const head = Object.fromEntries(
      i.head.filter((h) => h.text && h.role !== 'name' && h.role !== 'type').map((h) => [h.role, h.text]),
    )
    columns.push({
      col: colLetters(i.col),
      field: i.field,
      type: i.type,
      kind: i.kind,
      ...(i.list ? { list: { sep: i.sep } } : {}),
      ...(i.enumName
        ? {
            enum: {
              name: i.enumName,
              values: opts.slice(0, ENUM_VALUES).map((o) => (o.value ? `${o.name}（${o.value}）` : o.name)),
              ...(opts.length > ENUM_VALUES ? { more: opts.length - ENUM_VALUES } : {}),
            },
          }
        : {}),
      ...(i.ref ? { ref: i.ref } : {}),
      ...(i.min !== undefined ? { min: i.min } : {}),
      ...(i.max !== undefined ? { max: i.max } : {}),
      ...(i.allow?.length ? { allow: i.allow } : {}),
      ...(i.pattern ? { pattern: i.pattern } : {}),
      ...(i.required ? { required: true } : {}),
      ...(i.requiredWhen ? { requiredWhen: i.requiredWhen } : {}),
      ...(i.note ? { note: i.note } : {}),
      ...(Object.keys(head).length ? { head } : {}),
    })
  }
  const key = schema.style.key
  return {
    sheet: sheet.name,
    header: header.roles.map((role, k) => ({ row: header.start + k + 1, role })),
    dataFrom: from + 1,
    rows: Math.max(0, end - from),
    key: infos.some((i) => i.field === key) ? key : '',
    columns,
  }
}
