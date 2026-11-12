/**
 * 表格管理（游戏配置表）：项目设置里的表格配置、表格页用的数据结构、结构文件（表头规则、枚举、引用……）的格式。
 * 硬约束：表格文件本身只在用户保存改动时原地改写单元格，结构信息一律存在表格之外（见设计稿 designs/表格管理与在线编辑-设计稿.md）。
 */
import { z } from 'zod'
import { HeaderException, HeaderRule, emptyRule } from './table-header.ts'
import type { SheetData } from './files.ts'
import { TableExport } from './table-export.ts'

/** 默认认作表格的文件 */
export const TABLE_INCLUDE = '*.xlsx, *.xlsm, *.xls, *.csv, *.tsv'
/** 默认跳过：Office / WPS 打开文件时留下的锁文件 */
export const TABLE_EXCLUDE = '~$*, .~*'

/** 项目设置里的「表格」：表格目录（相对项目目录，或项目目录外的绝对路径）、包含 / 排除、结构信息存哪 */
export const TablesConfig = z.object({
  dirs: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  include: z.string().trim().max(300).default(TABLE_INCLUDE),
  exclude: z.string().trim().max(300).default(TABLE_EXCLUDE),
  /** project：项目目录 .agentpanel/tables/（能提交给团队）；data：只存本机数据目录 */
  store: z.enum(['project', 'data']).default('project'),
  /** 只读：表格页只能看、搜、对比，不能改 */
  readOnly: z.boolean().default(false),
  /** 导表脚本：表格页对表格执行的命令，路径用占位（见 table-export.ts） */
  exports: z.array(TableExport).max(20).default([]),
})
export type TablesConfig = z.infer<typeof TablesConfig>

/**
 * 项目上的表格设置：表格搬成插件后存在 project.plugins.tables（面板不认识里面的内容，原样存；
 * 面板的数据迁移 0005 把原来的 project.tables 挪了过来）。没设或格式不对时为 undefined
 */
export function tablesOf(p: { plugins?: Record<string, unknown> } | null | undefined): TablesConfig | undefined {
  const raw = p?.plugins?.tables
  return raw === undefined ? undefined : TablesConfig.safeParse(raw).data
}

/** 设了表格目录才算开了表格功能 */
export const tablesOn = (c: { dirs: string[] } | undefined): c is TablesConfig => !!c && c.dirs.length > 0

/** 表格文件的种类：xls（老二进制）只能看列表，不能解析、不能改 */
export type TableKind = 'xlsx' | 'csv' | 'xls'
export function tableKind(file: string): TableKind | null {
  if (/\.(xlsx|xlsm)$/i.test(file)) return 'xlsx'
  if (/\.(csv|tsv)$/i.test(file)) return 'csv'
  if (/\.(xls|et)$/i.test(file)) return 'xls'
  return null
}

/** 一个通配写法（* 任意字符、? 一个字符）转成正则；不带 / 的只比文件名，带 / 的比相对路径 */
const GLOB_CACHE = new Map<string, RegExp>() // 模块状态：缓存，丢了重算
function globRe(glob: string) {
  // 列几万个文件时每个文件都要比一遍：编译好的正则留着复用
  const hit = GLOB_CACHE.get(glob)
  if (hit) return hit
  const re = compileGlob(glob)
  if (GLOB_CACHE.size > 500) GLOB_CACHE.clear()
  GLOB_CACHE.set(glob, re)
  return re
}
function compileGlob(glob: string) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  // ** 跨目录：先拆开，各段里的 * 和 ? 不跨 /，再用 .* 接起来
  const body = esc
    .split(/\*\*\/?/)
    .map((part) => part.replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
    .join('.*')
  return new RegExp(`^${body}$`, 'i')
}

/** 逗号或换行分隔的一组通配 */
export const globList = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)

/** rel 是不是命中这一组通配（rel 用 / 分隔） */
export function globHit(rel: string, globs: string[]) {
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  return globs.some((g) => globRe(g).test(g.includes('/') ? rel : name))
}

/** 表格页左侧的一个文件 */
export interface TableFile {
  /** 相对项目目录，用 / */
  path: string
  kind: TableKind
  size: number
  mtime: string
}

/** 设置里的一个表格目录：实际找的位置、找到几个表格 */
export interface TableRoot {
  /** 设置里写的 */
  dir: string
  /** 实际找的磁盘路径（路径写法不对时为空） */
  full: string
  found: boolean
  files: number
}

export interface TablesIndex {
  /** 实际存在的表格目录（相对项目目录） */
  dirs: string[]
  /** 设置了但找不到的目录 */
  missing: string[]
  /** 设置里每个目录各自的情况（项目设置里逐条显示） */
  roots?: TableRoot[]
  files: TableFile[]
  /** 文件太多只列了前面一部分 */
  truncated?: boolean
}

/** 打开的一个表格文件 */
export interface TableDoc {
  path: string
  kind: TableKind
  sheets: SheetData[]
  size: number
  mtime: string
  /** 不能改的原因（老 xls、项目设了只读、文件太大被截断、有公式的表……）；没有就是能改 */
  readOnly?: string
  /** 正被 Excel / WPS 打开（同目录有 ~$ 锁文件） */
  locked?: boolean
  /** CSV 的分隔符、换行、有没有 BOM：保存时按原样写回 */
  csv?: { delimiter: string; eol: 'lf' | 'crlf'; bom: boolean; trailingEol?: boolean }
}

/** 内容搜索命中的一格 */
export interface TableHit {
  path: string
  sheet: string
  row: number
  col: number
  text: string
  /** 数据行的格子：这一列的字段名 */
  field?: string
  /** 数据行的格子：这一行主键的值（Agent 接着按主键查、改） */
  key?: string
  /** 命中的部分在 text 里的位置（高亮用）；没有时按查询的字自己找 */
  at?: [number, number]
}
export interface TableSearch {
  hits: TableHit[]
  /** 搜了几个文件 */
  files: number
  truncated?: boolean
  /** 按「字段名:值」只在这一列里找了 */
  field?: string
  /** 写了「字段名:值」但没有哪张表有这个字段：改成按整串找了 */
  fieldMissing?: string
}

// ---------- 结构文件 ----------

/** 一个枚举值 */
export const EnumValue = z.object({
  name: z.string().trim().min(1).max(200),
  value: z.string().trim().max(60).optional(),
  desc: z.string().trim().max(500).optional(),
})
export type EnumValue = z.infer<typeof EnumValue>

/**
 * 一个枚举：values 是结构文件里自己记的（手写的、在表格页新增的）；
 * source 指向一张枚举表时，那张表里的值也算（只读，加的值仍记在 values 里，见「写回源表」）
 */
export const TableEnum = z.object({
  values: z.array(EnumValue).max(5000).default([]),
  source: z
    .object({
      file: z.string().max(300),
      sheet: z.string().max(200).optional(),
      /** 只取这几行：枚举表里多个枚举放在一起时，用「枚举名」列筛 */
      match: z.object({ col: z.string().max(200), value: z.string().max(200) }).optional(),
      nameCol: z.string().max(200),
      valueCol: z.string().max(200).optional(),
      descCol: z.string().max(200).optional(),
    })
    .optional(),
})
export type TableEnum = z.infer<typeof TableEnum>

/** 一列的结构：枚举、引用别的表的主键、列表（repeated）、取值范围 */
export const TableColumn = z.object({
  /** 这一列数组的分隔符（不写就用项目的 listSep） */
  sep: z.string().min(1).max(4).optional(),
  /** 参数类型：表头类型行写错、没写时按这个处理（uint32、float、string……），表格不改 */
  type: z.string().trim().max(100).optional(),
  enum: z.string().max(200).optional(),
  /** 引用：「相对路径#字段名」或「相对路径#工作表#字段名」 */
  ref: z.string().max(500).optional(),
  list: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /** 除范围、枚举之外还允许的值（比如 -1 表示未配置） */
  allow: z.array(z.string().max(100)).max(50).optional(),
  /** 正则：整格要符合（数组列按每一项比） */
  pattern: z.string().max(300).optional(),
  /** 必填：不能空着 */
  required: z.boolean().optional(),
  /** 条件必填：同一行 field 那一列是 values 里的某个值时，这一列必填 */
  requiredWhen: z.object({ field: z.string().max(100), values: z.array(z.string().max(100)).max(50) }).optional(),
  note: z.string().max(500).optional(),
})
export type TableColumn = z.infer<typeof TableColumn>

/** 表头行的取值写这个：基础类型（style.primitives）+ 所有通用枚举的名字 */
export const TYPE_NAMES = '@types'

/** 项目的表格风格 */
export const TableStyle = z.object({
  /**
   * 项目的表头：一个「行」的数组，每项对应表格表头的一行（见 table-header.ts）。表格页完全按它显示，
   * 不按内容猜；rows 为空 = 还没配置，整张表都当数据
   */
  header: HeaderRule.default(emptyRule),
  /** 主键列的字段名 */
  key: z.string().trim().max(100).default('ID'),
  /** repeated 列表的分隔符 */
  listSep: z.string().max(4).default(';'),
  /** 修饰行里哪些值表示「这一列是数组」（不分大小写） */
  arrayMarks: z.array(z.string().trim().max(40)).max(20).default(['repeated']),
  /** 类型行里算基础类型的名字（其余的大驼峰名字当枚举 / 结构） */
  primitives: z.array(z.string().max(40)).max(80).default([]),
  /** 组合唯一：这些文件（通配）里几列合起来不能重复（比如 RoleID + Level） */
  uniques: z
    .array(z.object({ glob: z.string().max(300), fields: z.array(z.string().max(100)).min(2).max(8) }))
    .max(100)
    .default([]),
  /** 保存前检查：off 不查；warn 有不合规的格子时提醒但能保存；block 有不合规时不让保存 */
  saveCheck: z.enum(['off', 'warn', 'block']).default('warn'),
  /** 按文件指定的表头：这些文件（通配，可以细到工作表）用另一份表头，排在前面的优先 */
  exceptions: z.array(HeaderException).max(100).default([]),
})
export type TableStyle = z.infer<typeof TableStyle>

/**
 * 结构文件合起来的样子。存成 4 个文件（style / enums / columns / files .json），多人各改各的不容易冲突。
 * columns 的键是「相对路径#工作表#字段名」，工作表写 * 表示每张表；按字段名记，表格里插了列也不会错位
 */
export const TableSchema = z.object({
  style: TableStyle.default(() => TableStyle.parse({})),
  enums: z.record(z.string().max(200), TableEnum).default({}),
  columns: z.record(z.string().max(700), TableColumn).default({}),
  analyzedAt: z.string().max(40).optional(),
})
export type TableSchema = z.infer<typeof TableSchema>

export const emptySchema = (): TableSchema => TableSchema.parse({})

/** 一张表用的表头从哪来：按文件指定的第几条（只管这个工作表的 / 按通配的），或项目表头 */
export type HeaderSource = { kind: 'sheet' | 'file'; index: number } | { kind: 'project' }

/** 这条「按文件指定」管不管这张表：glob 为空的还没填，不生效 */
export function exceptionHits(e: HeaderException, file: string, sheet: string) {
  if (!e.glob.trim() || (e.sheet !== undefined && e.sheet !== sheet)) return false
  return e.glob === file || globHit(file, [e.glob])
}

/** 一张表的表头：按文件指定（排在前面的优先）> 项目表头。只看配置，不看表格内容 */
export function schemaHeader(s: TableSchema, file: string, sheet: string): { rule: HeaderRule; source: HeaderSource } {
  const i = s.style.exceptions.findIndex((e) => exceptionHits(e, file, sheet))
  if (i < 0) return { rule: s.style.header, source: { kind: 'project' } }
  const e = s.style.exceptions[i]
  return { rule: e.header, source: { kind: e.sheet !== undefined ? 'sheet' : 'file', index: i } }
}

/** 一列的结构：先找本工作表的，再找「每张表」的 */
export const colKey = (file: string, sheet: string, field: string) => `${file}#${sheet}#${field}`
export function schemaColumn(s: TableSchema, file: string, sheet: string, field: string): TableColumn | undefined {
  return s.columns[colKey(file, sheet, field)] ?? s.columns[colKey(file, '*', field)]
}
