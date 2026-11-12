/**
 * 表格页的选中和编辑：像表格软件一样点格子选中、拖动选一块（拖到边上自动滚）、方向键移动（跳过筛掉的行）、
 * 点行号选整行、点列名选整列（按住拖、Shift 点扩大）、拖选区右下角的填充柄填充、
 * 直接打字或双击 / F2 改、Enter / Tab 确认并移动、Esc 取消、Delete 清空、
 * Ctrl+C / X / V 复制剪切粘贴（和 Excel / WPS 互通的 TSV）、Ctrl+Z / Y 撤销重做、Ctrl+S 保存。
 * 快捷键在 grid-keys.ts，拖动在 use-drag-select.ts，填充柄在 grid-fill-drag.ts。
 */
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { parseClip, toClip, type CellSet } from '@shared/table-edit'
import { toast } from '@/lib/toast'
import { t } from '@shared/i18n'
import type { SheetEditing } from '@/components/files/SheetTable'
import { fillDown } from '@shared/table-tools'
import type { CellMove } from './CellEditor'
import { gridKeyDown } from './grid-keys'
import { cellVisible, firstVisible } from './grid-dom'
import { useDragSelect, type DragKind, type DragPoint } from './use-drag-select'
import { fillDragEnd, fillDragMove, type FillDrag } from './grid-fill-drag'

export interface Pos {
  row: number
  col: number
}

/** 选的是整行 / 整列：范围的另一维铺满（整列只含数据行，表头不跟着被清空、批量改） */
export type Whole = 'row' | 'col' | null

export interface GridEditOpts {
  rows: string[][]
  cols: number
  /** 数据从第几行开始（上面是表头） */
  from: number
  /** 筛选排序后显示的数据行 */
  order: number[]
  readOnly: boolean
  /** 实际的行高（跟着紧凑 / 宽松和设置走）：翻页按它算 */
  rowH: number
  onCells: (cells: CellSet[]) => void
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  /** 正在改的格子用什么编辑框：枚举列是下拉，其余是文字框 */
  editor: (p: Pos, init: string, done: (v: string | null, move?: CellMove) => void) => React.ReactNode
  mark?: SheetEditing['mark']
  tip?: SheetEditing['tip']
  rowMenu?: SheetEditing['rowMenu']
  /** Ctrl+H：打开查找替换 */
  onFind?: () => void
  /** 隐藏的列：左右移动时跳过 */
  hiddenCol?: (c: number) => boolean
  /** Ctrl+F：表格顶部的查找条 */
  onFindBar?: () => void
  /** Ctrl+G：跳到某行或某个主键 */
  onGoto?: () => void
  /** Ctrl+Shift+=：在这一行上方插 n 行（选中几行插几行） */
  onInsertAbove?: (row: number, n: number) => void
  /** Ctrl+-：删掉这些行（行号从大到小） */
  onDeleteRows?: (rows: number[]) => void
  /** Alt+↑ / ↓：把从 at 起连着的 n 行挪一行；挪不了返回 false */
  onMoveRows?: (at: number, n: number, dir: -1 | 1) => boolean
  /** F1 / Ctrl+/：快捷键表 */
  onHelp?: () => void
  /** 格子里显示的字（引用列「ID · 名称」） */
  display?: (r: number, c: number, text: string) => string
}

export function useGridEdit(o: GridEditOpts) {
  const [anchor, setAnchor] = useState<Pos | null>(null)
  const [focus, setFocus] = useState<Pos | null>(null)
  const [whole, setWhole] = useState<Whole>(null)
  const [seq, setSeq] = useState(0)
  const [editing, setEditing] = useState<{ p: Pos; init: string } | null>(null)
  /** 拖填充柄时：拖之前的选区和现在要填到哪（选区先跟着变大，松手才真的填） */
  const [fillDrag, setFillDrag] = useState<FillDrag | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const gridId = useId()

  // 显示顺序：表头行 + 筛选排序后的数据行；方向键按它走
  const line = useMemo(() => [...Array.from({ length: o.from }, (_, i) => i), ...o.order], [o.from, o.order])
  const posOf = useMemo(() => new Map(line.map((r, i) => [r, i])), [line])

  const go = useCallback((p: Pos, extend = false) => {
    setFocus(p)
    if (!extend) {
      setAnchor(p)
      setWhole(null)
    }
    setSeq((n) => n + 1)
  }, [])
  const move = (dr: number, dc: number, extend = false) => {
    if (!focus) return
    const i = posOf.get(focus.row) ?? 0
    const row = line[Math.min(Math.max(0, i + dr), line.length - 1)] ?? focus.row
    const last = Math.max(0, o.cols - 1)
    let col = Math.min(Math.max(0, focus.col + dc), last)
    // 落在隐藏的列上：接着往同一个方向走；走到头还是隐藏的就往回找
    if (dc && o.hiddenCol) {
      const dir = Math.sign(dc)
      while (o.hiddenCol(col) && col + dir >= 0 && col + dir <= last) col += dir
      while (o.hiddenCol(col) && col - dir >= 0 && col - dir <= last) col -= dir
    }
    go({ row, col }, extend)
  }

  /** 选中的一块（按显示顺序的第几行、第几列）：整行时列铺满，整列时数据行铺满 */
  const range = useMemo(() => {
    if (!focus) return null
    const a = anchor ?? focus
    const ia = posOf.get(a.row) ?? 0
    const ib = posOf.get(focus.row) ?? 0
    const r = {
      i0: Math.min(ia, ib),
      i1: Math.max(ia, ib),
      c0: Math.min(a.col, focus.col),
      c1: Math.max(a.col, focus.col),
    }
    if (whole === 'row') return { ...r, c0: 0, c1: Math.max(0, o.cols - 1) }
    // 没有数据行（只有表头、或全被筛掉）时整列退回整个显示范围
    if (whole === 'col') return { ...r, i0: line.length > o.from ? o.from : 0, i1: line.length - 1 }
    return r
  }, [anchor, focus, posOf, whole, o.cols, o.from, line.length])
  /** 选中的格子（按显示顺序，筛掉的行不算） */
  const picked = () => {
    if (!range) return []
    const out: Pos[] = []
    for (let i = range.i0; i <= range.i1; i++)
      for (let c = range.c0; c <= range.c1; c++) out.push({ row: line[i], col: c })
    return out
  }

  /** 选整行（r 那一行；extend 时从原来的起点扩到这一行）：当前格停在看得见的列上，不把表格横着滚走 */
  const pickRow = (r: number, extend: boolean) => {
    const el = box.current
    const col = focus && el && cellVisible(el, focus.row, focus.col) ? focus.col : ((el && firstVisible(el).c) ?? 0)
    if (extend && anchor) {
      setFocus({ row: r, col })
      if (whole !== 'row') setAnchor({ row: anchor.row, col })
    } else {
      setAnchor({ row: r, col })
      setFocus({ row: r, col })
    }
    setWhole('row')
  }
  /** 选整列：当前格停在看得见的那一行，不跳回表头 */
  const pickCol = (c: number, extend: boolean) => {
    const el = box.current
    const vis = el ? firstVisible(el).r : null
    const row =
      focus && el && cellVisible(el, focus.row, focus.col)
        ? focus.row
        : vis !== null && vis >= o.from
          ? vis
          : (line[o.from] ?? line[0] ?? 0)
    if (extend && anchor) {
      setFocus({ row, col: c })
      if (whole !== 'col') setAnchor({ row, col: anchor.col })
    } else {
      setAnchor({ row, col: c })
      setFocus({ row, col: c })
    }
    setWhole('col')
  }

  const startEdit = (init?: string) => {
    if (!focus) return
    if (o.readOnly) return toast.error(t('这张表现在不能改'))
    setEditing({ p: focus, init: init ?? o.rows[focus.row]?.[focus.col] ?? '' })
  }
  const done = (v: string | null, dir?: CellMove) => {
    const cur = editing
    setEditing(null)
    // Ctrl+Enter：选中的每一格都改成这个值（批量设值，一次撤销）
    if (cur && v !== null && dir === 'all') {
      const all = picked().filter((p) => !o.hiddenCol?.(p.col))
      o.onCells(all.length ? all.map((p) => ({ r: p.row, c: p.col, v })) : [{ r: cur.p.row, c: cur.p.col, v }])
      box.current?.focus({ preventScroll: true })
      return
    }
    if (cur && v !== null) o.onCells([{ r: cur.p.row, c: cur.p.col, v }])
    if (dir && dir !== 'all') {
      const [dr, dc] = { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1] }[dir]
      move(dr, dc)
    }
    box.current?.focus({ preventScroll: true })
  }

  const copy = async (cut: boolean) => {
    if (!range) return
    const block: string[][] = []
    for (let i = range.i0; i <= range.i1; i++) {
      const r = line[i]
      const row: string[] = []
      for (let c = range.c0; c <= range.c1; c++) row.push(o.rows[r]?.[c] ?? '')
      block.push(row)
    }
    await navigator.clipboard.writeText(toClip(block)).catch(() => toast.error(t('浏览器不让写剪贴板')))
    if (cut && !o.readOnly) o.onCells(picked().map((p) => ({ r: p.row, c: p.col, v: '' })))
  }
  const paste = (text: string) => {
    if (!focus || o.readOnly) return
    const block = parseClip(text)
    if (!block.length) return
    // 选中一块、剪贴板只有一格：填满选中的那块（和表格软件一样）
    const one = block.length === 1 && block[0].length === 1
    const cells: CellSet[] =
      one && range && (range.i1 > range.i0 || range.c1 > range.c0)
        ? picked().map((p) => ({ r: p.row, c: p.col, v: block[0][0] }))
        : block.flatMap((row, i) => {
            // 往下贴按显示顺序走（筛选后贴进看得见的行）；超出最后一行就接着往下加行
            const at = (posOf.get(focus.row) ?? 0) + i
            const r = line[at] ?? Math.max(o.rows.length, line[line.length - 1] + 1) + (at - line.length)
            return row.map((v, j) => ({ r, c: focus.col + j, v }))
          })
    o.onCells(cells)
    if (!one) go({ row: cells[cells.length - 1].r, col: cells[cells.length - 1].c }, true)
  }

  /** 向下填充选中的一块：series 时数字按步长递增 */
  const fill = (series: boolean) => {
    if (o.readOnly || !range) return
    const rowsSel = line.slice(range.i0, range.i1 + 1).filter((r) => r >= o.from)
    const colsSel: number[] = []
    for (let c = range.c0; c <= range.c1; c++) if (!o.hiddenCol?.(c)) colsSel.push(c)
    const cells = fillDown(o.rows, rowsSel, colsSel, series)
    if (cells.length) o.onCells(cells)
    else toast.info(t('先选中要填充的几行（第一行是要往下填的值）'))
  }

  /** Alt+↑ / ↓：选中的几行整体挪一行，选区跟着走 */
  const moveRows = (dir: -1 | 1) => {
    if (!range || o.readOnly || !o.onMoveRows) return
    const rs = line.slice(range.i0, range.i1 + 1)
    const at = rs[0]
    if (at < o.from) return toast.info(t('表头行不能移动'))
    const next = line[dir < 0 ? range.i0 - 1 : range.i1 + 1]
    // 到头了：不动
    if (next === undefined || next < o.from) return
    // 筛选、排序后看到的相邻两行在表里不一定挨着，挪了会让人看不懂
    if (rs.some((r, i) => r !== at + i) || next !== (dir < 0 ? at - 1 : at + rs.length))
      return toast.info(t('只能移动表里连着的几行：有筛选或排序时先清掉再移'))
    if (!o.onMoveRows(at, rs.length, dir)) return
    setAnchor((a) => a && { ...a, row: a.row + dir })
    setFocus((f) => f && { ...f, row: f.row + dir })
    setSeq((n) => n + 1)
  }

  const drag = useDragSelect(
    box,
    (kind: DragKind, p: DragPoint) => {
      if (kind === 'fill')
        return (
          fillDrag &&
          setFillDrag(fillDragMove(fillDrag, p, { line, posOf, hiddenCol: o.hiddenCol, rows: o.rows, from: o.from }))
        )
      if (p.r === null && kind !== 'cols') return
      if (kind === 'rows') return setFocus((f) => ({ row: p.r!, col: f?.col ?? 0 }))
      if (p.c === null) return
      if (kind === 'cols') return setFocus((f) => ({ row: f?.row ?? line[o.from] ?? 0, col: p.c! }))
      setFocus({ row: p.r!, col: p.c })
    },
    (kind: DragKind, p: DragPoint) => {
      if (kind !== 'fill' || !fillDrag) return
      const end = fillDragMove(fillDrag, p, { line, posOf, hiddenCol: o.hiddenCol, rows: o.rows, from: o.from })
      setFillDrag(null)
      const res = fillDragEnd(end, { line, hiddenCol: o.hiddenCol, rows: o.rows, from: o.from })
      if (res.cells.length) o.onCells(res.cells)
      // 填完选中原来那块加填进去的那几格；当前格回到原来的位置
      setAnchor(res.anchor)
      setFocus(res.focus)
    },
  )

  const selection = useMemo(
    () =>
      range
        ? {
            rows: line.slice(range.i0, range.i1 + 1),
            cols: Array.from({ length: range.c1 - range.c0 + 1 }, (_, i) => range.c0 + i),
            whole,
          }
        : null,
    [range, line, whole],
  )

  // 拖填充柄时选区先跟着变大，看得出要填到哪；松手前不改数据
  const view = fillDrag?.preview ?? range

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return
    gridKeyDown(e, {
      o,
      focus,
      range,
      line,
      posOf,
      whole,
      go,
      move,
      box,
      copy,
      fill,
      startEdit,
      moveRows,
      pickRow,
      pickCol,
      selectAll: () => {
        setAnchor({ row: line[0], col: 0 })
        setFocus({ row: line[line.length - 1], col: o.cols - 1 })
        setWhole(null)
      },
      clear: () => !o.readOnly && o.onCells(picked().map((p) => ({ r: p.row, c: p.col, v: '' }))),
    })
  }

  // 填充柄画在选区右下角（最后一列没被隐藏的那格）；只读、正在改、正在拖时不画
  const handleCell = (() => {
    if (!view || o.readOnly || editing) return null
    let c = view.c1
    while (c > view.c0 && o.hiddenCol?.(c)) c--
    return { r: line[view.i1], c }
  })()

  const edit: SheetEditing = {
    picked: (r, c) => {
      if (!view || c < view.c0 || c > view.c1) return false
      const i = posOf.get(r)
      return i !== undefined && i >= view.i0 && i <= view.i1
    },
    focus,
    focusSeq: seq,
    focusId: focus ? `${gridId}-r${focus.row}c${focus.col}` : undefined,
    editing: editing ? { r: editing.p.row, c: editing.p.col, node: o.editor(editing.p, editing.init, done) } : null,
    mark: o.mark,
    tip: o.tip,
    rowMenu: o.rowMenu,
    display: o.display,
    onDown: (r, c, e) => {
      if (e.button !== 0) return
      e.preventDefault()
      box.current?.focus({ preventScroll: true })
      go({ row: r, col: c }, e.shiftKey)
      drag.start('cells', e)
    },
    // 拖的时候按每帧的鼠标坐标找格子（use-drag-select），这里不用再跟着 mouseenter 走
    onEnter: () => {},
    onDouble: (r, c) => {
      go({ row: r, col: c })
      if (!o.readOnly) setEditing({ p: { row: r, col: c }, init: o.rows[r]?.[c] ?? '' })
    },
    onRowDown: (r, e) => {
      box.current?.focus({ preventScroll: true })
      // 右键：点在选中的行上保留选区（右键菜单按选中的几行算），点在外面先选中这一行
      if (e.button === 2) {
        const i = posOf.get(r)
        if (!(range && i !== undefined && i >= range.i0 && i <= range.i1)) pickRow(r, false)
        return
      }
      if (e.button !== 0) return
      e.preventDefault()
      pickRow(r, e.shiftKey)
      drag.start('rows', e)
    },
    onColDown: (c, e) => {
      if (e.button !== 0) return
      e.preventDefault()
      box.current?.focus({ preventScroll: true })
      pickCol(c, e.shiftKey)
      drag.start('cols', e)
    },
    handle: handleCell
      ? {
          ...handleCell,
          onDown: (e) => {
            if (e.button !== 0 || !range || !focus) return
            e.preventDefault()
            e.stopPropagation()
            setFillDrag({ from: range, active: focus, preview: range, dir: null, target: [], tip: null })
            drag.start('fill', e)
          },
        }
      : undefined,
  }
  return {
    edit,
    box,
    focus,
    go,
    picked,
    fill,
    moveRows,
    /** 拖填充柄时鼠标旁边的提示：最远那一格会填成什么 */
    fillTip: fillDrag?.tip ?? null,
    /** 选中的一块：按显示顺序的行、列（只有一格时也算）；选区不变就是同一个对象 */
    selection: () => selection,
    editing: !!editing,
    onKeyDown,
    onPaste: (e: React.ClipboardEvent) => {
      if (editing) return
      e.preventDefault()
      paste(e.clipboardData.getData('text/plain'))
    },
    /** 能聚焦的表格容器上的读屏属性：role=grid，当前格用 aria-activedescendant 指过去 */
    boxProps: {
      role: 'grid',
      'aria-multiselectable': true,
      'aria-readonly': o.readOnly || undefined,
      'aria-rowcount': o.rows.length,
      'aria-colcount': o.cols,
      'aria-activedescendant': editing ? undefined : edit.focusId,
    } as const,
  }
}
