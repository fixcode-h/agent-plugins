/**
 * 插删列以后，本机记的那些「按第几列记」的东西跟着挪：隐藏的列、冻结到第几列、拖过的列宽、列筛选和排序。
 * 不挪的话插一列以后，原来隐藏的 C 列变成了新插的那列，筛选也落到别的列上。全是纯函数。
 */
import { mapCol, type ColOp } from '@shared/table-edit'
import type { ColLayout } from '@/components/files/SheetTable'
import type { ColFilters, SheetSort } from '@/lib/sheet-filter'

/** 撤销一步列操作要做的反操作：插入的删掉，删掉的插回空列（原来的内容由撤销的快照带回来） */
export const invertCols = (ops: ColOp[]): ColOp[] => [...ops].reverse().map((op) => ({ at: op.at, n: -op.n }))

/**
 * 列操作从 before 变成 after 时，本机状态要照着做的操作：
 * 多出来的（新做的、重做的）照做；少了的（撤销的）反着做。两边不是前后缀关系（不该发生）时不挪
 */
export function colDelta(before: ColOp[], after: ColOp[]): ColOp[] | null {
  const same = (a: ColOp, b: ColOp) => a.at === b.at && a.n === b.n
  if (after.length >= before.length && before.every((op, i) => same(op, after[i]))) return after.slice(before.length)
  if (before.length > after.length && after.every((op, i) => same(op, before[i])))
    return invertCols(before.slice(after.length))
  return null
}

export function shiftLayout(l: ColLayout, ops: ColOp[]): ColLayout {
  const hidden = l.hidden.map((c) => mapCol(c, ops)).filter((c) => c >= 0)
  // 冻结前 freeze 列：最后一列冻结列挪到哪，就冻结到哪；它被删了就往前找还在的
  let freeze = 0
  for (let c = l.freeze - 1; c >= 0; c--) {
    const to = mapCol(c, ops)
    if (to >= 0) {
      freeze = to + 1
      break
    }
  }
  return { freeze, hidden }
}

export function shiftWidths(w: Record<number, number>, ops: ColOp[]) {
  const out: Record<number, number> = {}
  for (const [k, v] of Object.entries(w)) {
    const to = mapCol(Number(k), ops)
    if (to >= 0) out[to] = v
  }
  return out
}

export function shiftFilters(f: ColFilters, sort: SheetSort | null, ops: ColOp[]) {
  const filters: ColFilters = {}
  for (const [k, v] of Object.entries(f)) {
    const to = mapCol(Number(k), ops)
    if (to >= 0) filters[to] = v
  }
  const col = sort ? mapCol(sort.col, ops) : -1
  return { filters, sort: sort && col >= 0 ? { ...sort, col } : null }
}

/** 面板表格记拖过的列宽用的键（SheetTable 的 useColWidths）：这里直接改本机记录，表格重新挂上时读到新的 */
export function shiftStoredWidths(widthKey: string, ops: ColOp[]) {
  const key = `sheet-colw:${widthKey}`
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return
    localStorage.setItem(key, JSON.stringify(shiftWidths(JSON.parse(raw) as Record<number, number>, ops)))
  } catch {
    // 本机存不了（隐私模式）：列宽本来也只在这次打开里有效
  }
}
