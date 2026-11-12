/**
 * 评审里表格（.xlsx / .xlsm）的语义差异：git diff 对表格只有一行「二进制文件不同」，这里按格子比
 * （和表格页的版本差异同一套 diffSheet），按主键对齐行，写出哪一格从什么改成什么。
 * 面板评审经插件的 textify.diff 调（插件接口 6）；这份文字是发给评审 Agent 的提示词，不翻译
 */
import type { SheetData } from './files.ts'
import { diffSheet, type DiffSide } from './sheet-diff.ts'
import { headerOf } from './table-struct.ts'
import { fieldNames } from './table-agent.ts'
import type { TableSchema } from './tables.ts'

/** 一格的值在差异里最多显示的字数 */
const CELL_MAX = 120

const short = (v: string) => {
  const s = v.replace(/\r?\n/g, '⏎')
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…` : s
}
const quote = (v: string) => (v === '' ? '（空）' : short(v))

function sideOf(schema: TableSchema, file: string, sheet: SheetData): DiffSide {
  const h = headerOf(schema, file, sheet)
  return { rows: sheet.rows, from: h.start + h.roles.length, names: fieldNames(sheet.rows, h) }
}

const colName = (names: string[] | undefined, c: number) => names?.[c] || `第 ${c + 1} 列`

/** 一行有内容的格子写成「字段=值」，空格子不写 */
function rowText(row: string[] | undefined, names: string[] | undefined) {
  const cells = (row ?? []).flatMap((v, c) => (v.trim() ? [`${colName(names, c)}=${short(v)}`] : []))
  const s = cells.join('，')
  return s.length > 600 ? `${s.slice(0, 600)}…` : s || '（空行）'
}

/** 一张工作表两版的格子级差异；没有变化返回空串 */
function sheetText(file: string, name: string, a: SheetData, b: SheetData, schema: TableSchema) {
  const sa = sideOf(schema, file, a)
  const sb = sideOf(schema, file, b)
  const d = diffSheet(sa, sb, schema.style.key)
  const { mod, add, del, cells } = d.stats
  if (!mod && !add && !del && !d.addedCols.length && !d.removedCols.length && !d.headerChanged.length) return ''
  const kc = d.key ? (sb.names ?? []).indexOf(d.key) : -1
  // 行怎么称呼：有主键用主键，没有用表格软件里的行号（从 1 数）
  const label = (row: string[] | undefined, n: number | undefined) =>
    kc >= 0 && row?.[kc] ? `${d.key}=${row[kc]}` : n === undefined ? '' : `第 ${n + 1} 行`
  const head = [
    `工作表「${name}」：改 ${mod} 行（${cells} 格）、加 ${add} 行、删 ${del} 行`,
    d.key ? `按主键 ${d.key} 对齐行` : '没有主键，按整行内容对齐',
    d.addedCols.length ? `新加列 ${d.addedCols.join('、')}` : '',
    d.removedCols.length ? `去掉列 ${d.removedCols.join('、')}` : '',
    d.headerChanged.length ? `表头（类型、注释）变了的列 ${d.headerChanged.join('、')}` : '',
  ].filter(Boolean)
  const lines = [head.join('；')]
  if (a.truncated || b.truncated) lines.push('（表太大，只比了前面读出来的部分）')
  for (const r of d.rows) {
    if (r.kind === 'same') continue
    const ra = r.a === undefined ? undefined : a.rows[r.a]
    const rb = r.b === undefined ? undefined : b.rows[r.b]
    if (r.kind === 'mod') {
      const what = (r.cols ?? []).map(
        (c) => `${colName(sb.names, c)} ${quote(ra?.[d.colMap[c]] ?? '')} → ${quote(rb?.[c] ?? '')}`,
      )
      lines.push(`- 改 ${label(rb, r.b)}：${what.join('；')}`)
    } else if (r.kind === 'add') lines.push(`- 加 ${label(rb, r.b)}：${rowText(rb, sb.names)}`)
    else lines.push(`- 删 ${label(ra, r.a)}：${rowText(ra, sa.names)}`)
  }
  return lines.join('\n')
}

/** 新建或删掉的整个表格：列出工作表、行数和字段，内容太多不逐行列 */
function wholeBook(sheets: SheetData[], schema: TableSchema, file: string) {
  return sheets
    .map((s) => {
      const side = sideOf(schema, file, s)
      const names = (side.names ?? []).filter(Boolean)
      return `- 工作表「${s.name}」：${Math.max(0, s.rows.length - side.from)} 行数据${names.length ? `，字段 ${names.join('、')}` : ''}`
    })
    .join('\n')
}

/** 两版表格（null 是这一版没有这个文件）的格子级差异文字；没有变化返回空串 */
export function workbookDiffText(file: string, a: SheetData[] | null, b: SheetData[] | null, schema: TableSchema) {
  if (!a && !b) return ''
  if (!a) return `新建的表格：\n${wholeBook(b!, schema, file)}`
  if (!b) return `删掉的表格（原来的内容）：\n${wholeBook(a, schema, file)}`
  const out: string[] = []
  const names = new Set(a.map((s) => s.name))
  for (const s of b) {
    const old = a.find((x) => x.name === s.name)
    if (!old) out.push(`新加的工作表：\n${wholeBook([s], schema, file)}`)
    else {
      const t = sheetText(file, s.name, old, s, schema)
      if (t) out.push(t)
    }
    names.delete(s.name)
  }
  for (const n of names) out.push(`删掉的工作表：\n${wholeBook([a.find((x) => x.name === n)!], schema, file)}`)
  return out.join('\n\n')
}
