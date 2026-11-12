/**
 * 表格页按屏幕位置找格子：拖选、填充柄、点行号列名时用。表格只画看得见的行列（虚拟滚动），
 * 所以按坐标问浏览器「这里是哪一格」最准，不用自己按行高、列宽再算一遍（冻结列、隐藏列、筛选都不用管）。
 * 只认 SheetTable 画出来的几个标记：格子的 data-r / data-c、行的 aria-rowindex、钉在顶上的 data-sheet-head、左上角的 data-sheet-corner。
 */

export interface GridArea {
  top: number
  bottom: number
  left: number
  right: number
}

/** 数据区在屏幕上的范围：滚动区里去掉钉在顶上的列头 / 表头、左边的行号列、滚动条 */
export function gridArea(box: HTMLElement, withHead = false): GridArea {
  const rect = box.getBoundingClientRect()
  const head = box.querySelector('[data-sheet-head]')?.getBoundingClientRect()
  const corner = box.querySelector('[data-sheet-corner]')?.getBoundingClientRect()
  return {
    top: withHead || !head ? rect.top : Math.max(rect.top, head.bottom),
    bottom: rect.top + box.clientHeight,
    left: corner ? Math.max(rect.left, corner.right) : rect.left,
    right: rect.left + box.clientWidth,
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/**
 * 屏幕上这一点是哪一格（点在数据区外面时按最近的边算）：r / c 找不到时是 null
 * （没画出来的空白列、铺满用的空行）。
 * 拖的时候只认整格都露出来的格子：边上露半截的那格不算，退回里面一格——
 * 不然当前格落到半截的格子上，表格会为了让它露全而一下子滚出半屏，和自动滚动叠在一起就窜得飞快
 */
export function cellAt(box: HTMLElement, x: number, y: number, withHead = false) {
  const a = gridArea(box, withHead)
  let px = clamp(x, a.left + 1, a.right - 2)
  let py = clamp(y, a.top + 1, a.bottom - 2)
  let el = document.elementFromPoint(px, py) as HTMLElement | null
  const cell0 = el?.closest<HTMLElement>('[data-r]')
  if (cell0) {
    const b = cell0.getBoundingClientRect()
    // 比可见区还大的格子（很宽的列）不退，退了反而找不到
    if (b.bottom > a.bottom + 1 && b.top - 2 > a.top) py = b.top - 2
    else if (b.top < a.top - 1 && b.bottom + 2 < a.bottom) py = b.bottom + 2
    if (b.right > a.right + 1 && b.left - 2 > a.left) px = b.left - 2
    else if (b.left < a.left - 1 && b.right + 2 < a.right) px = b.right + 2
    if (px !== clamp(x, a.left + 1, a.right - 2) || py !== clamp(y, a.top + 1, a.bottom - 2))
      el = document.elementFromPoint(px, py) as HTMLElement | null
  }
  if (!el || !box.contains(el)) return { r: null, c: null }
  const cell = el.closest<HTMLElement>('[data-r]')
  const row = el.closest<HTMLElement>('[aria-rowindex]')
  const r = cell ? Number(cell.dataset.r) : row ? Number(row.getAttribute('aria-rowindex')) - 1 : null
  const c = cell?.dataset.c !== undefined ? Number(cell.dataset.c) : null
  return { r, c }
}

/** 这一格整个在数据区里看得见吗（没画出来、被列头或行号列挡住都算看不见） */
export function cellVisible(box: HTMLElement, r: number, c: number) {
  const el = box.querySelector(`[data-r="${r}"][data-c="${c}"]`)
  if (!el) return false
  const a = gridArea(box)
  const b = el.getBoundingClientRect()
  return b.top >= a.top - 1 && b.bottom <= a.bottom + 1 && b.left >= a.left - 1 && b.right <= a.right + 1
}

/** 数据区左上角那一格（选整列时当前格停在看得见的第一行，不跳走） */
export const firstVisible = (box: HTMLElement) => {
  const a = gridArea(box)
  return cellAt(box, a.left + 4, a.top + 4)
}

/** 拖到边上时每帧（按 60 帧算）滚多少像素：离边越远越快（像 Excel），贴着边慢慢挪 */
const EDGE = 24
const MAX_STEP = 160
export function edgeSpeed(p: number, lo: number, hi: number) {
  if (hi - lo < EDGE * 3) return 0
  const d = p < lo + EDGE ? -(lo + EDGE - p) : p > hi - EDGE ? p - (hi - EDGE) : 0
  if (!d) return 0
  return Math.sign(d) * Math.min(MAX_STEP, Math.ceil((Math.abs(d) / 8) ** 1.7))
}
