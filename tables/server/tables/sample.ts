/**
 * AI 分析表格风格用的样本。不读全部表格：按目录轮着挑几张 xlsx / csv 列成清单交给 AI，
 * AI 再一张一张用面板动作 table.sample 读（每次只读一张：表头 + 前几行数据 + 这张表里类型名出现过的值），
 * 这样提示词不会因为表多、表宽而超长。只读文件，不写任何东西。
 */
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { detectSheetHeader } from '../../shared/sheet-header.ts'
import type { TableFile } from '../../shared/tables.ts'
import { parseTable, tableFull } from './files.ts'

/** 最多挑这么多张表给 AI 看 */
export const SAMPLE_FILES = 8
/** 表头之后再取几行数据 */
const DATA_ROWS = 3
/** 表头没认出来时取开头几行 */
const ROWS = 8
const COLS = 40
const CELL = 30
/** 每个类型名最多收这么多个不同的值 */
const VALUES = 30
/** 一张表的样本最长这么多字 */
export const ONE_MAX = 6000
const BASIC = /^(s?int(8|16|32|64)?|uint(8|16|32|64)?|u?long|u?short|byte|float|double|bool(ean)?|string|bytes|text)$/i

/** 挑样本：按目录轮着取，免得全是同一个目录的 */
export function pickSamples(files: TableFile[], n = SAMPLE_FILES) {
  const byDir = new Map<string, TableFile[]>()
  for (const f of files.filter((x) => x.kind !== 'xls')) {
    const d = path.posix.dirname(f.path)
    byDir.set(d, [...(byDir.get(d) ?? []), f])
  }
  const out: TableFile[] = []
  const lists = [...byDir.values()]
  for (let i = 0; out.length < n && lists.some((l) => l.length > i); i++)
    for (const l of lists) if (l[i] && out.length < n) out.push(l[i])
  return out
}

const cut = (s: string) => (s.length > CELL ? `${s.slice(0, CELL)}…` : s).replace(/[\t\n\r]/g, ' ')

/** 统计表头取值时最多看这么多张表、单张表最大这么大（大表多半是数据表，表头和小表一样） */
export const STAT_FILES = 40
const STAT_BYTES = 4 * 1024 * 1024
/** 表头里只能填固定几个值的行：修饰、导出端、其它（分组、导出标记这类） */
const STAT_ROLES = new Set(['modifier', 'side', 'other'])
/** 表头最多看前几行 */
const STAT_ROWS = 8
const WORD = /^[A-Za-z_][\w.-]{0,30}$/

/**
 * 全项目表头里固定取值行（修饰、导出端……）出现过的值：只看 8 张样本时常漏掉少见的取值（用户 2026-11-16：导出端漏了 Public），
 * 所以按目录轮着多挑一些表，只读表头那几行，按行的种类汇总不同的值和出现次数交给 AI。只读文件
 */
export async function headerValues(dir: string, files: TableFile[]) {
  // 按「表头第几行」汇总，不按每张表各自认出的种类：少见的取值（Public）会让那一行认不出是导出端，
  // 按行号收再用多数表认出的种类给这一行定名，少见的值才不会漏
  const rows = Array.from({ length: STAT_ROWS }, () => ({
    values: new Map<string, number>(),
    roles: new Map<string, number>(),
  }))
  let seen = 0
  for (const f of pickSamples(files, STAT_FILES)) {
    const full = tableFull(dir, f.path)
    const st = await stat(full).catch(() => null)
    if (!st || st.size > STAT_BYTES) continue
    const sheets = await parseTable(full)
      .then((d) => d.sheets)
      .catch(() => null)
    if (!sheets) continue
    seen++
    for (const sh of sheets.slice(0, 4)) {
      const h = detectSheetHeader(sh.rows)
      const start = h.roles.length ? h.start : 0
      rows.forEach((row, i) => {
        const role = h.roles[i]
        if (role) row.roles.set(role, (row.roles.get(role) ?? 0) + 1)
        for (const v of sh.rows[start + i] ?? []) {
          const x = v.trim()
          if (x && WORD.test(x) && (row.values.size < 40 || row.values.has(x)))
            row.values.set(x, (row.values.get(x) ?? 0) + 1)
        }
      })
    }
  }
  const name: Record<string, string> = { modifier: '修饰行', side: '导出端行', other: '其它表头行' }
  const lines = rows.flatMap((row, i) => {
    const role = [...row.roles].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!role || !STAT_ROLES.has(role) || !row.values.size) return []
    const vals = [...row.values].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}（${n}）`)
    return [`- 表头第 ${i + 1} 行（${name[role] ?? role}）：${vals.join('、')}`]
  })
  if (!lines.length) return ''
  return [
    `看了 ${seen} 张表的表头（按目录轮着挑），固定取值的表头行里出现过的值（括号里是出现的格子数）：`,
    ...lines,
  ].join('\n')
}

/** 交给 AI 的清单：挑出来的几张表（路径、工作表、行数），不含内容；后面附上全项目表头固定取值的统计 */
export async function tableSample(dir: string, files: TableFile[]): Promise<{ text: string; files: number }> {
  const lines: string[] = []
  for (const f of pickSamples(files)) {
    const sheets = await parseTable(tableFull(dir, f.path))
      .then((d) => d.sheets)
      .catch(() => null)
    if (!sheets) continue
    lines.push(`- ${f.path}（${sheets.map((s) => `${s.name} ${s.rows.length} 行`).join('、')}）`)
  }
  return { text: lines.join('\n'), files: lines.length }
}

/** 一张表的样本：每个工作表（最多 2 个）的表头 + 前几行数据，再加这张表里类型名出现过的值 */
export async function sampleOne(full: string, rel: string): Promise<string> {
  const { sheets } = await parseTable(full)
  const parts: string[] = []
  const values = new Map<string, Set<string>>()
  for (const s of sheets.slice(0, 2)) {
    const h = detectSheetHeader(s.rows)
    const from = h.start + h.roles.length
    const end = h.roles.length ? Math.min(from + DATA_ROWS, h.start + 12) : ROWS
    const lines = s.rows.slice(0, end).map((r, i) => `${i + 1}\t${r.slice(0, COLS).map(cut).join('\t')}`)
    parts.push(`### ${rel}${sheets.length > 1 ? ` · ${s.name}` : ''}（${s.rows.length} 行）\n${lines.join('\n')}`)
    const ti = h.roles.indexOf('type')
    if (ti < 0) continue
    ;(s.rows[h.start + ti] ?? []).forEach((type, c) => {
      const name = type.trim()
      if (!/^[A-Z][A-Za-z0-9_]+$/.test(name) || BASIC.test(name)) return
      const set = values.get(name) ?? new Set<string>()
      values.set(name, set)
      for (let r = from; r < s.rows.length && set.size < VALUES; r++)
        for (const v of (s.rows[r]?.[c] ?? '').split(/[;|,]/)) if (v.trim()) set.add(cut(v.trim()))
    })
  }
  if (values.size)
    parts.push(
      `### 这张表里类型名出现过的值\n${[...values]
        .map(([k, v]) => `${k}: ${[...v].join(', ')}${v.size >= VALUES ? ' …' : ''}`)
        .join('\n')}`,
    )
  const text = parts.join('\n\n')
  return text.length > ONE_MAX ? `${text.slice(0, ONE_MAX)}\n…（太长，后面省略）` : text
}
