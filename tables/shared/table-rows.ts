/**
 * 表格页的整行操作：一次插几行（主键依次编号）、把连着的几行上移 / 下移一行。
 * 移动行只改格子、不做行操作：几行的内容轮换一下就是挪了位置。这样 xlsx 里的行样式、公式表的结构都不动，
 * 外面改过文件时也能按「只改格子」那条路保存；撤销一次就回去。全是纯函数，页面一次提交。
 */
import type { CellSet } from './table-edit.ts'
import { nextKey } from './table-tools.ts'

/**
 * 在 at 插 n 行时要顺手填的格子：主键列从下一个编号起依次 +1；copy 是要复制的那一行（只复制一行时用）
 */
export function insertRowsCells(
  rows: string[][],
  o: { at: number; n: number; from: number; keyCol: number; copy?: number },
): CellSet[] {
  const cells: CellSet[] = []
  const src = o.copy === undefined ? [] : (rows[o.copy] ?? [])
  const first = o.keyCol >= 0 && o.at >= o.from ? nextKey(rows, o.from, o.keyCol) : ''
  for (let i = 0; i < o.n; i++) {
    src.forEach((v, c) => v && cells.push({ r: o.at + i, c, v }))
    if (first) cells.push({ r: o.at + i, c: o.keyCol, v: String(BigInt(first) + BigInt(i)) })
  }
  return cells
}

/**
 * 把从 at 起连着的 n 行挪一行（dir = -1 上移、1 下移）：被挤开的那一行换到另一头。
 * 返回要改的格子（只含真的变了的），越界（挪到表头里、挪出最后一行）返回 null
 */
export function moveRowsCells(rows: string[][], at: number, n: number, dir: -1 | 1, from: number): CellSet[] | null {
  if (n <= 0) return null
  const lo = dir < 0 ? at - 1 : at
  const hi = dir < 0 ? at + n - 1 : at + n
  if (lo < from || hi >= rows.length) return null
  // 轮换：上移时 [被挤的, 块...] → [块..., 被挤的]；下移时 [块..., 被挤的] → [被挤的, 块...]
  const old = rows.slice(lo, hi + 1)
  const next = dir < 0 ? [...old.slice(1), old[0]] : [old[old.length - 1], ...old.slice(0, -1)]
  const width = Math.max(...old.map((r) => r.length))
  const cells: CellSet[] = []
  next.forEach((row, i) => {
    for (let c = 0; c < width; c++) {
      const v = row[c] ?? ''
      if (v !== (old[i][c] ?? '')) cells.push({ r: lo + i, c, v })
    }
  })
  return cells
}
