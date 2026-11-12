/**
 * 表格页的快捷键（use-grid-edit 的键盘部分）：
 * Ctrl+方向键跳到这一段数据的边缘、Ctrl+Home / End、Shift+空格选整行、Ctrl+空格选整列、
 * PageUp / PageDown 按实际行高翻一屏、Ctrl+Shift+= 在上方插行（选中几行插几行）、Ctrl+- 删选中的行、
 * Alt+↑ / ↓ 把选中的行上移 / 下移、Ctrl+D 向下填充（Ctrl+Shift+D 按序列递增）、
 * Ctrl+F 表内查找、Ctrl+H 查找替换、Ctrl+G 跳到行或主键、F1 / Ctrl+/ 快捷键表。
 * 需要的东西都从 ctx 传进来，不读外层闭包。
 */
import { t } from '@shared/i18n'
import { toast } from '@/lib/toast'
import { gridArea } from './grid-dom'
import type { GridEditOpts, Pos, Whole } from './use-grid-edit'

export interface GridKeyCtx {
  o: GridEditOpts
  focus: Pos | null
  range: { i0: number; i1: number; c0: number; c1: number } | null
  line: number[]
  /** 行号 → 显示的第几行 */
  posOf: Map<number, number>
  whole: Whole
  box: React.RefObject<HTMLDivElement | null>
  go: (p: Pos, extend?: boolean) => void
  move: (dr: number, dc: number, extend?: boolean) => void
  copy: (cut: boolean) => void
  fill: (series: boolean) => void
  startEdit: (init?: string) => void
  moveRows: (dir: -1 | 1) => void
  pickRow: (r: number, extend: boolean) => void
  pickCol: (c: number, extend: boolean) => void
  selectAll: () => void
  clear: () => void
}

/**
 * Ctrl+方向键：像 Excel 一样跳到这一段数据的边缘——当前格和下一格都有字就走到连续一段的最后一格，
 * 否则跳过空格子停在下一个有字的格子（没有就到头）
 */
function edge(x: GridKeyCtx, dr: number, dc: number, extend: boolean) {
  const { o, line, focus } = x
  if (!focus) return
  const filled = (i: number, c: number) => !!(o.rows[line[i]]?.[c] ?? '').trim()
  let i = x.posOf.get(focus.row) ?? 0
  let c = focus.col
  const last = Math.max(0, o.cols - 1)
  const step = () => {
    const ni = i + dr
    let nc = c + dc
    while (dc && o.hiddenCol?.(nc) && nc + dc >= 0 && nc + dc <= last) nc += dc
    if (ni < 0 || ni >= line.length || nc < 0 || nc > last) return false
    i = ni
    c = nc
    return true
  }
  const next = () => {
    const ni = i + dr
    const nc = c + dc
    return ni >= 0 && ni < line.length && nc >= 0 && nc <= last && filled(ni, nc)
  }
  if (filled(i, c) && next()) {
    while (next() && step());
  } else {
    while (step() && !filled(i, c));
  }
  x.go({ row: line[i], col: c }, extend)
}

/**
 * PageUp / PageDown：按实际行高（紧凑 / 宽松、设置里的行高）和数据区的高度（去掉钉在顶上的列头、表头）算一屏几行，
 * 表格和当前格一起翻一屏，当前格停在屏幕上原来的位置
 */
function page(x: GridKeyCtx, down: boolean, extend: boolean) {
  const el = x.box.current
  const a = el ? gridArea(el) : null
  const h = a ? a.bottom - a.top : 400
  const n = Math.max(1, Math.floor(h / x.o.rowH) - 1)
  if (el) el.scrollTop += (down ? n : -n) * x.o.rowH
  x.move(down ? n : -n, 0, extend)
}

export function gridKeyDown(e: React.KeyboardEvent, x: GridKeyCtx) {
  const { o, focus, range, line } = x
  const mod = e.ctrlKey || e.metaKey
  const k = e.key
  const key = k.toLowerCase()
  const run = (f: () => void) => {
    e.preventDefault()
    f()
  }
  if (mod && key === 'z') return run(() => (e.shiftKey ? o.onRedo() : o.onUndo()))
  if (mod && key === 'y') return run(o.onRedo)
  if (mod && key === 's') return run(o.onSave)
  if (mod && key === 'c') return run(() => x.copy(false))
  if (mod && key === 'x') return run(() => x.copy(true))
  if (mod && key === 'h' && o.onFind) return run(o.onFind)
  // Ctrl+D 向下填充（复制选中区第一行）；Ctrl+Shift+D 按序列递增
  if (mod && key === 'd') return run(() => x.fill(e.shiftKey))
  if (mod && key === 'f' && o.onFindBar) return run(o.onFindBar)
  if (mod && key === 'g' && o.onGoto) return run(o.onGoto)
  if ((k === 'F1' || (mod && k === '/')) && o.onHelp) return run(o.onHelp)
  if (mod && key === 'a') return run(x.selectAll)
  if (!focus) return
  if (mod && k === 'Home') return run(() => x.go({ row: line[0], col: 0 }, e.shiftKey))
  if (mod && k === 'End')
    return run(() => x.go({ row: line[line.length - 1], col: Math.max(0, o.cols - 1) }, e.shiftKey))
  // Shift+空格选整行、Ctrl+空格选整列（整列只含数据行）
  if (k === ' ' && e.shiftKey && !mod) return run(() => x.pickRow(focus.row, false))
  if (k === ' ' && mod) return run(() => x.pickCol(focus.col, false))
  if (mod && e.shiftKey && (k === '+' || k === '=') && !o.readOnly && o.onInsertAbove) {
    // 选中几行就插几行（和 Excel 一样），插在选中的最上面那一行上方
    const rows = range ? line.slice(range.i0, range.i1 + 1) : [focus.row]
    const n = x.whole === 'col' ? 1 : rows.length
    return run(() => o.onInsertAbove!(Math.min(...rows), n))
  }
  if (mod && k === '-' && !o.readOnly && o.onDeleteRows) {
    e.preventDefault()
    // 选的是整列时别一下删光所有数据行
    if (x.whole === 'col') return toast.info(t('选中的是整列：要删行先选中那几行'))
    const rows = range ? [...new Set(line.slice(range.i0, range.i1 + 1))] : [focus.row]
    // 表头行不删
    o.onDeleteRows(rows.filter((r) => r >= o.from).sort((a, b) => b - a))
    return
  }
  if (e.altKey && !mod && (k === 'ArrowUp' || k === 'ArrowDown')) return run(() => x.moveRows(k === 'ArrowUp' ? -1 : 1))
  const arrows: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  }
  if (arrows[k]) {
    e.preventDefault()
    const [dr, dc] = arrows[k]
    return mod ? edge(x, dr, dc, e.shiftKey) : x.move(dr, dc, e.shiftKey)
  }
  if (k === 'Tab') return run(() => x.move(0, e.shiftKey ? -1 : 1))
  if (k === 'PageDown' || k === 'PageUp') return run(() => page(x, k === 'PageDown', e.shiftKey))
  if (k === 'Enter' || k === 'F2') return run(() => x.startEdit())
  if (k === 'Delete' || k === 'Backspace') return run(x.clear)
  // 直接打字：从这个字开始改（输入法的组字交给编辑框）
  if (k.length === 1 && !mod && !e.altKey) return run(() => x.startEdit(k))
}
