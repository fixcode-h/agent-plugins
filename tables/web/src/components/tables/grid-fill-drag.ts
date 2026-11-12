/**
 * 拖填充柄：鼠标拖到选区下面 / 上面就按列往那边填，拖到右边 / 左边就按行填（看离选区哪个方向更远，和 Excel 一样）。
 * 拖的过程中只算「要填到哪」和鼠标旁的提示（最远那格会填成什么），松手才真的改格子，一次撤销。
 * 筛掉的行、隐藏的列不填；往下往上只填数据行，不改表头。规律见 shared/table-fill.ts。
 */
import { extendSeries, fillHandle, type FillDir } from '@shared/table-fill'
import type { CellSet } from '@shared/table-edit'
import type { DragPoint } from './use-drag-select'

/** 按显示顺序的第几行（i）和第几列（c） */
export interface GridRange {
  i0: number
  i1: number
  c0: number
  c1: number
}

export interface FillDrag {
  /** 拖之前的选区和当前格 */
  from: GridRange
  active: { row: number; col: number }
  /** 加上要填的那几格之后的选区（画出来给人看） */
  preview: GridRange
  dir: FillDir | null
  /** 要填的行号（往下 / 往上）或列号（往右 / 往左），按显示顺序 */
  target: number[]
  ctrl?: boolean
  /** 鼠标旁边的提示：最远那一格会填成什么 */
  tip: { x: number; y: number; text: string } | null
}

export interface FillCtx {
  line: number[]
  rows: string[][]
  from: number
  hiddenCol?: (c: number) => boolean
}

const visibleCols = (ctx: FillCtx, a: number, b: number) => {
  const out: number[] = []
  for (let c = a; c <= b; c++) if (!ctx.hiddenCol?.(c)) out.push(c)
  return out
}

/** 选区里拿来当规律的几格：往下 / 往上按列，只取数据行；往右 / 往左按行 */
function sourceOf(f: GridRange, dir: FillDir, ctx: FillCtx) {
  const rows = ctx.line.slice(f.i0, f.i1 + 1)
  const cols = visibleCols(ctx, f.c0, f.c1)
  return dir === 'down' || dir === 'up' ? { rows: rows.filter((r) => r >= ctx.from), cols } : { rows, cols }
}

export function fillDragMove(d: FillDrag, p: DragPoint, ctx: FillCtx & { posOf: Map<number, number> }): FillDrag {
  if (p.r === null && p.c === null) return d
  const f = d.from
  const ti = p.r === null ? undefined : ctx.posOf.get(p.r)
  const rowOver = ti === undefined ? 0 : ti > f.i1 ? ti - f.i1 : ti < f.i0 ? ti - f.i0 : 0
  const colOver =
    p.c === null
      ? 0
      : p.c > f.c1
        ? visibleCols(ctx, f.c1 + 1, p.c).length
        : p.c < f.c0
          ? -visibleCols(ctx, p.c, f.c0 - 1).length
          : 0
  let dir: FillDir | null = null
  let preview = f
  let target: number[] = []
  if (rowOver && Math.abs(rowOver) >= Math.abs(colOver)) {
    dir = rowOver > 0 ? 'down' : 'up'
    preview = rowOver > 0 ? { ...f, i1: ti! } : { ...f, i0: ti! }
    const span = rowOver > 0 ? ctx.line.slice(f.i1 + 1, ti! + 1) : ctx.line.slice(ti!, f.i0)
    target = span.filter((r) => r >= ctx.from)
  } else if (colOver) {
    dir = colOver > 0 ? 'right' : 'left'
    preview = colOver > 0 ? { ...f, c1: p.c! } : { ...f, c0: p.c! }
    target = colOver > 0 ? visibleCols(ctx, f.c1 + 1, p.c!) : visibleCols(ctx, p.c!, f.c0 - 1)
  }
  let tip: FillDrag['tip'] = null
  if (dir && target.length) {
    const src = sourceOf(f, dir, ctx)
    const vertical = dir === 'down' || dir === 'up'
    // 提示只算第一条线（第一列 / 第一行）最远那格：几千行也只是一串字符串运算
    const vals = vertical
      ? src.rows.map((r) => ctx.rows[r]?.[src.cols[0]] ?? '')
      : src.cols.map((c) => ctx.rows[src.rows[0]]?.[c] ?? '')
    if (vals.length && (vertical ? src.cols.length : src.rows.length)) {
      const ordered = dir === 'down' || dir === 'right' ? vals : [...vals].reverse()
      const out = extendSeries(ordered, target.length, p.ctrl)
      tip = { x: p.x, y: p.y, text: out[out.length - 1] ?? '' }
    }
  }
  return { ...d, preview, dir, target, tip, ctrl: p.ctrl }
}

/** 选区里和当前格相对的那个角：松手后当前格回到原处，选区照样是整块 */
function anchorFor(g: GridRange, active: { row: number; col: number }, line: number[]) {
  const i = line.indexOf(active.row)
  return {
    row: i - g.i0 <= g.i1 - i ? line[g.i1] : line[g.i0],
    col: active.col - g.c0 <= g.c1 - active.col ? g.c1 : g.c0,
  }
}

export function fillDragEnd(
  d: FillDrag,
  ctx: FillCtx,
): { cells: CellSet[]; anchor: { row: number; col: number }; focus: { row: number; col: number } } {
  if (!d.dir || !d.target.length) return { cells: [], anchor: anchorFor(d.from, d.active, ctx.line), focus: d.active }
  const src = sourceOf(d.from, d.dir, ctx)
  const cells = src.rows.length && src.cols.length ? fillHandle(ctx.rows, src, d.dir, d.target, d.ctrl) : []
  return { cells, anchor: anchorFor(d.preview, d.active, ctx.line), focus: d.active }
}
