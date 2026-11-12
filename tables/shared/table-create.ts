/**
 * 新建表格：按项目的表头配置（一个「行」的数组）生成新表的开头几行。
 * 新建弹窗里每一列按表头的每一行填（字段名、类型、注释……），这里拼成表格的行交给服务端写文件。
 * 只写表头，不带数据行；表头之前的几行（start > 0）留空。
 */
import { z } from 'zod'
import { t } from './i18n.ts'
import type { HeaderRule } from './table-header.ts'

/** 新建表格最多这么多列 */
export const NEW_TABLE_MAX_COLS = 500
/** 能新建的格式 */
export const NEW_TABLE_EXTS = ['xlsx', 'csv', 'tsv'] as const
export type NewTableExt = (typeof NEW_TABLE_EXTS)[number]

/** 新建表格的请求：path 是表格目录里的位置（和表格页的文件路径一样写），rows 是整张表的内容 */
export const TableCreate = z.object({
  path: z.string().trim().min(1).max(600),
  /** xlsx 的工作表名 */
  sheet: z.string().trim().min(1).max(31).default('Sheet1'),
  rows: z.array(z.array(z.string().max(2000)).max(NEW_TABLE_MAX_COLS)).max(1100),
  /** xlsx 打开时冻结前几行（表头） */
  freeze: z.number().int().min(0).max(1100).default(0),
})
export type TableCreate = z.infer<typeof TableCreate>

/** 新建弹窗里的一列：cells[i] 是表头第 i 行这一列填什么 */
export interface NewColumn {
  cells: string[]
}

/** 拼新表的行：start 之前留空行，表头每行一行，每列按 cells 填 */
export function newTableRows(rule: HeaderRule, cols: NewColumn[]): string[][] {
  const blank = Array.from({ length: rule.start }, () => [] as string[])
  const head = rule.rows.map((_, i) => cols.map((c) => (c.cells[i] ?? '').trim()))
  return [...blank, ...head]
}

/** Excel 工作表名不能有这些字，最长 31 */
const BAD_SHEET = /[\\/?*[\]:]/

/**
 * 新建前的检查，返回要提示的问题（空数组就是能建）：文件名、格式、工作表名，
 * 字段名行不能空、不能重复（表格页按字段名找列）
 */
export function newTableIssues(
  name: string,
  sheet: string,
  rule: HeaderRule,
  cols: NewColumn[],
  exists: (name: string) => boolean,
): string[] {
  const out: string[] = []
  const file = name.trim()
  const ext = /\.([^./\\]+)$/.exec(file)?.[1]?.toLowerCase()
  if (!file || /[<>:"|?*]/.test(file) || file.split(/[\\/]/).some((p) => p === '..' || !p))
    out.push(t('文件名不对：不能空着，不能有 < > : " | ? * 和 ..'))
  else if (!ext || !(NEW_TABLE_EXTS as readonly string[]).includes(ext))
    out.push(t('文件名要以 .xlsx、.csv 或 .tsv 结尾'))
  else if (exists(file)) out.push(t('已经有这个文件了'))
  if (ext === 'xlsx' && (!sheet.trim() || sheet.length > 31 || BAD_SHEET.test(sheet)))
    out.push(t('工作表名不能空着，最长 31 个字，不能有 \\ / ? * [ ] :'))
  if (!cols.length) out.push(t('至少要有一列'))
  const ni = rule.rows.findIndex((r) => r.kind === 'name')
  if (ni >= 0) {
    const names = cols.map((c) => (c.cells[ni] ?? '').trim())
    if (names.some((n) => !n)) out.push(t('每一列都要填字段名'))
    const dup = names.find((n, i) => n && names.indexOf(n) !== i)
    if (dup) out.push(t('字段名「{name}」重复了', { name: dup }))
  }
  return out
}
