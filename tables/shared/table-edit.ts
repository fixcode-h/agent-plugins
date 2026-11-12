/**
 * 表格页的改动：页面上改格子、增删行，保存时发给服务端的是「行操作 + 改了的格子」，
 * 服务端在磁盘上的文件上照做一遍、写回后重新解析，和这里算出来的结果逐格对上才算保存成功。
 * 页面和服务端用同一份 applyRowOps / setCells，两边算出来的「应该是什么样」一定一致。
 */
import { z } from 'zod'

/** 一个行操作：在 at 处插入 n 行（n > 0）或从 at 起删掉 -n 行（n < 0） */
export const RowOp = z.object({
  at: z.number().int().min(0).max(1_048_575),
  n: z
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((n) => n !== 0),
})
export type RowOp = z.infer<typeof RowOp>

/** 一个列操作：在 at 列处插入 n 列（n > 0）或从 at 列起删掉 -n 列（n < 0）；xlsx 最多 16384 列 */
export const ColOp = z.object({
  at: z.number().int().min(0).max(16_383),
  n: z
    .number()
    .int()
    .min(-16_384)
    .max(16_384)
    .refine((n) => n !== 0),
})
export type ColOp = z.infer<typeof ColOp>

export const CellSet = z.object({
  r: z.number().int().min(0).max(1_048_575),
  c: z.number().int().min(0).max(16_383),
  v: z.string().max(32_767),
})
export type CellSet = z.infer<typeof CellSet>

export const SheetEdit = z.object({
  name: z.string().max(200),
  /** 先按顺序做行操作，再按顺序做列操作；格子的行列号是都做完之后的 */
  rows: z.array(RowOp).max(1000).default([]),
  /** 列操作（加字段、删字段）：和行操作互不影响，先做哪个结果都一样。没有列操作时不写（老的调用方不用管） */
  cols: z.array(ColOp).max(200).optional(),
  cells: z.array(CellSet).max(200_000).default([]),
})
export type SheetEdit = z.infer<typeof SheetEdit>

export const TableSave = z.object({
  path: z.string().min(1).max(600),
  /** 打开时文件的修改时间：对不上说明外面改过 */
  mtime: z.string().max(40),
  sheets: z.array(SheetEdit).min(1).max(100),
  /** 外面改过也照样把这些格子写进去（只改格子、没有行列操作时才允许） */
  force: z.boolean().optional(),
})
export type TableSave = z.infer<typeof TableSave>

/** 做行操作（不改原数组）：插入的是空行 */
export function applyRowOps(rows: string[][], ops: RowOp[]): string[][] {
  const out = rows.map((r) => [...r])
  for (const op of ops) {
    if (op.n > 0) {
      while (out.length < op.at) out.push([])
      out.splice(op.at, 0, ...Array.from({ length: op.n }, () => [] as string[]))
    } else out.splice(op.at, -op.n)
  }
  return out
}

/**
 * 做列操作（不改原数组）：插入的是空列。每一行单独挪，行比插入位置短的不用补空格子
 * （行尾的空格子本来就不存），所以和行操作谁先谁后结果一样
 */
export function applyColOps(rows: string[][], ops: ColOp[]): string[][] {
  if (!ops.length) return rows.map((r) => [...r])
  return rows.map((r) => {
    const out = [...r]
    for (const op of ops) {
      if (op.at >= out.length) continue
      if (op.n > 0) out.splice(op.at, 0, ...Array.from({ length: op.n }, () => ''))
      else out.splice(op.at, -op.n)
    }
    return out
  })
}

/** 行操作、列操作都做完（不改原数组） */
export const applyOps = (rows: string[][], ops: RowOp[], cols: ColOp[] = []) =>
  cols.length ? applyColOps(applyRowOps(rows, ops), cols) : applyRowOps(rows, ops)

/** 一个格子在做完列操作之后到了哪一列；被删掉了返回 -1（草稿恢复、外部改动对位用） */
export function mapCol(c: number, ops: ColOp[]): number {
  let x = c
  for (const op of ops) {
    if (op.n > 0) {
      if (x >= op.at) x += op.n
    } else if (x >= op.at) {
      if (x < op.at - op.n) return -1
      x += op.n
    }
  }
  return x
}

/** 把格子写进去（改原数组） */
export function setCells(rows: string[][], cells: CellSet[]) {
  for (const { r, c, v } of cells) {
    while (rows.length <= r) rows.push([])
    const row = rows[r]
    while (row.length <= c) row.push('')
    row[c] = v
  }
  return rows
}

/** 去掉每行末尾的空格子、表末尾的空行：解析出来的表不带这些，比较前两边都这样收一下 */
export function trimGrid(rows: string[][]): string[][] {
  const out = rows.map((r) => {
    let n = r.length
    while (n > 0 && !r[n - 1]) n--
    return r.slice(0, n)
  })
  while (out.length && !out[out.length - 1].length) out.pop()
  return out
}

/** 两张表收过之后是不是一样；不一样时给出第一处不同（报错时说清楚哪一格） */
export function gridDiff(a: string[][], b: string[][]): { r: number; c: number; a: string; b: string } | null {
  const x = trimGrid(a)
  const y = trimGrid(b)
  for (let r = 0; r < Math.max(x.length, y.length); r++) {
    const ra = x[r] ?? []
    const rb = y[r] ?? []
    for (let c = 0; c < Math.max(ra.length, rb.length); c++)
      if ((ra[c] ?? '') !== (rb[c] ?? '')) return { r, c, a: ra[c] ?? '', b: rb[c] ?? '' }
  }
  return null
}

/** 页面上：原表做完行列操作后和现在的表比，哪些格子变了 */
export function changedCells(base: string[][], ops: RowOp[], now: string[][], cols: ColOp[] = []): CellSet[] {
  const before = applyOps(base, ops, cols)
  const out: CellSet[] = []
  for (let r = 0; r < Math.max(before.length, now.length); r++) {
    const a = before[r] ?? []
    const b = now[r] ?? []
    for (let c = 0; c < Math.max(a.length, b.length); c++)
      if ((a[c] ?? '') !== (b[c] ?? '')) out.push({ r, c, v: b[c] ?? '' })
  }
  return out
}

/** 一格的名字：第 0 行第 2 列 → C1 */
export function cellRef(r: number, c: number) {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return `${s}${r + 1}`
}

/** 粘贴：从剪贴板的 TSV（Excel / WPS 复制出来的就是）拆成行列；Excel 复制时末尾多一个换行 */
export function parseClip(text: string): string[][] {
  const t = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  if (!t) return []
  // 带引号的多行格子（Excel 复制有换行的格子时会加引号）
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"' && cell === '') q = true
    else if (ch === '\t') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  rows.push(row)
  return rows
}

/** 复制：选中的一块写成 TSV，有换行、制表符、引号的格子加引号 */
export function toClip(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[\t\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join('\t')).join('\n')
}
