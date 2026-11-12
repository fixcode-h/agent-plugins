/**
 * 表格页里 xlsx 还原的显示（合并单元格、批注、超链接、整行底色，面板 SheetTable 画）跟着没保存的插删行挪位置：
 * 读出来的位置是文件里的行号，页面上插了、删了行之后，下面的都要跟着移；删掉的行上的批注、链接、底色一起不显示。
 * 合并单元格的 xlsx 本来就不让在中间插删行（server/tables/xlsx-write.ts 拒绝），这里只是照样挪，不会拆开。
 */
import type { SheetLook, SheetMerge } from './files.ts'
import type { RowOp } from './table-edit.ts'

/** 原来的第 r 行做完行操作后在哪一行；被删掉了返回 -1 */
export function rowAfter(r: number, ops: RowOp[]): number {
  let at = r
  for (const op of ops) {
    if (op.n > 0) {
      if (at >= op.at) at += op.n
    } else if (at >= op.at) {
      if (at < op.at - op.n) return -1
      at += op.n
    }
  }
  return at
}

export function shiftLook(look: SheetLook | undefined, ops: RowOp[] | undefined): SheetLook | undefined {
  if (!look || !ops?.length) return look
  const move = <T extends { r: number }>(list: T[] | undefined) => {
    if (!list) return undefined
    const out: T[] = []
    for (const x of list) {
      const r = rowAfter(x.r, ops)
      if (r >= 0) out.push(r === x.r ? x : { ...x, r })
    }
    return out
  }
  const merges = look.merges?.flatMap((m): SheetMerge[] => {
    const top = rowAfter(m.r, ops)
    const bottom = rowAfter(m.r + m.rows - 1, ops)
    if (top < 0 || bottom < 0 || bottom < top) return []
    return [{ ...m, r: top, rows: bottom - top + 1 }]
  })
  return {
    ...(merges ? { merges } : {}),
    ...(look.notes ? { notes: move(look.notes) } : {}),
    ...(look.links ? { links: move(look.links) } : {}),
    ...(look.fills ? { fills: move(look.fills) } : {}),
  }
}
