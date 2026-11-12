/**
 * 表格页的增删列：列名 / 格子右键里的「插入列」「删除列」、插列弹窗、删列确认，
 * 以及插删列（含撤销重做）以后把本机按列号记的东西（隐藏、冻结、列宽、筛选排序）跟着挪。
 * xlsx 能不能在中间插删列问服务端（同一套拒绝规则），结果按文件的修改时间缓存；真正把关在保存时。
 */
import { useEffect, useRef, useState } from 'react'
import { Columns3, Trash2 } from 'lucide-react'
import { t } from '@shared/i18n'
import type { SheetData } from '@shared/files'
import type { SheetHeader } from '@shared/sheet-header'
import type { ColOp } from '@shared/table-edit'
import type { TableDoc } from '@shared/tables'
import type { EnumOption } from '@shared/table-struct'
import { colCount, colName } from '@/lib/sheet'
import { tablesApi } from '@/lib/tables-api'
import { toastError } from '@/lib/toast'
import type { ColLayout } from '@/components/files/SheetTable'
import type { ColFilters, SheetSort } from '@/lib/sheet-filter'
import { ConfirmDialog } from '@/components/ui/dialog'
import { ContextMenuItem } from '@/components/ui/menu'
import { ColumnInsertDialog } from './ColumnInsertDialog'
import { colOpIn, type Edits } from './table-edits'
import { colDelta, shiftFilters, shiftLayout, shiftStoredWidths } from './col-shift'

type Check = Record<string, { why: string[]; last: number }>

export interface ColEditCtx {
  projectId: string
  doc: TableDoc
  sheet: SheetData | undefined
  rows: string[][] | null
  header: SheetHeader | undefined
  readOnly: boolean
  /** 这张表现在做过的列操作（撤销重做时跟着变） */
  cols: ColOp[]
  fields: string[]
  /** 表头第 i 行能填的值（下拉建议） */
  optionsFor: (i: number) => EnumOption[] | undefined
  /** 选中的列（右键的列在选区里时，删的是选中的这几列） */
  selectedCols: () => number[]
  onEdits: (f: (e: Edits) => Edits) => void
  layout: ColLayout
  setLayout: (l: ColLayout) => void
  view: { filters: ColFilters; sort: SheetSort | null; setAll: (f: ColFilters, s: SheetSort | null) => void } | null
  /** 面板表格记列宽的键 */
  widthKey: string
}

export function useColEdit(ctx: ColEditCtx) {
  const { doc, sheet, rows } = ctx
  const [insert, setInsert] = useState<{ anchor: number; side: 'left' | 'right' | 'end' } | null>(null)
  const [del, setDel] = useState<{ cols: number[]; filled: number } | null>(null)
  // 能不能在中间插删列：按文件修改时间缓存（保存后文件变了重新问）
  const [check, setCheck] = useState<{ mtime: string; data: Check | null } | null>(null)
  const ask = () => {
    if (doc.kind !== 'xlsx' || check?.mtime === doc.mtime) return
    setCheck({ mtime: doc.mtime, data: null })
    tablesApi
      .shiftCheck(ctx.projectId, doc.path)
      .then((data) => setCheck((c) => (c?.mtime === doc.mtime ? { mtime: doc.mtime, data } : c)))
      .catch((e) => {
        toastError(e)
        setCheck(null)
      })
  }
  const info = doc.kind !== 'xlsx' ? { why: [], last: -1 } : check?.data ? check.data[sheet?.name ?? ''] : undefined
  /** 不能在中间插删的原因：[] = 可以；null = 还在问 */
  const blocked = doc.kind !== 'xlsx' ? [] : check?.data ? (info?.why ?? []) : null
  // 列操作排在原文件的列之后算「最后」：带样式的空格子也算原文件的列（和保存时的判断一样）
  const end = Math.max(rows ? colCount(rows) : 0, (info?.last ?? -1) + 1 + netCols(ctx.cols))

  // 插删列（含撤销重做）以后：隐藏的列、冻结、列宽、筛选排序跟着挪；保存或重新载入以后从头记
  const seen = useRef<{ key: string; cols: ColOp[] }>({ key: '', cols: [] })
  const [epoch, setEpoch] = useState(0)
  const key = `${doc.path}#${doc.mtime}#${sheet?.name ?? ''}`
  useEffect(() => {
    const prev = seen.current
    seen.current = { key, cols: ctx.cols }
    if (prev.key !== key) return
    const ops = colDelta(prev.cols, ctx.cols)
    if (!ops?.length) return
    ctx.setLayout(shiftLayout(ctx.layout, ops))
    shiftStoredWidths(ctx.widthKey, ops)
    if (ctx.view) {
      const v = shiftFilters(ctx.view.filters, ctx.view.sort, ops)
      ctx.view.setAll(v.filters, v.sort)
    }
    // 面板表格的列宽读本机记录只在挂上时读一次：换个 key 让它重新读
    setEpoch((n) => n + 1)
    // 只在列操作变时挪；layout、view 是挪的对象，不是触发条件
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ctx.cols])

  const openInsert = (anchor: number, side: 'left' | 'right' | 'end') => {
    ask()
    setInsert({ anchor, side })
  }
  const openDelete = (col: number) => {
    if (!rows) return
    ask()
    const sel = ctx.selectedCols()
    const cols = sel.includes(col) ? sel : [col]
    let filled = 0
    for (const r of rows) for (const c of cols) if (r[c]) filled++
    setDel({ cols, filled })
  }
  /** 删几列（连续的、不连续的都行）：从右往左删，列号不用换算；一次撤销退掉 */
  const doDelete = (cols: number[]) => {
    if (!sheet) return
    const runs: ColOp[] = []
    const sorted = [...new Set(cols)].sort((a, b) => b - a)
    for (const c of sorted) {
      const last = runs[runs.length - 1]
      if (last && last.at === c + 1) runs[runs.length - 1] = { at: c, n: last.n - 1 }
      else runs.push({ at: c, n: -1 })
    }
    ctx.onEdits((e) => {
      // 几段删除记成几步列操作，但合成一次撤销：先做第一段，后面的接在同一个快照上
      let next = colOpIn(e, sheet, runs[0])
      for (const op of runs.slice(1)) {
        const step = colOpIn(next, sheet, op)
        next = { ...step, undo: next.undo }
      }
      return next
    })
  }

  /** 列名右键、格子右键里的几项 */
  const menu = (col: number) =>
    ctx.readOnly || !sheet ? null : (
      <>
        <ContextMenuItem onSelect={() => openInsert(col, 'left')}>
          <Columns3 className="tb:h-3.5 tb:w-3.5 tb:text-subtle" />
          {t('在左边插入一列…')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => openInsert(col, 'right')}>
          <Columns3 className="tb:h-3.5 tb:w-3.5 tb:text-subtle" />
          {t('在右边插入一列…')}
        </ContextMenuItem>
        <ContextMenuItem danger onSelect={() => openDelete(col)}>
          <Trash2 className="tb:h-3.5 tb:w-3.5" />
          {(() => {
            const sel = ctx.selectedCols()
            return sel.includes(col) && sel.length > 1
              ? t('删除选中的 {n} 列', { n: sel.length })
              : t('删除 {col} 列{field}', {
                  col: colName(col),
                  field: ctx.fields[col] ? `（${ctx.fields[col]}）` : '',
                })
          })()}
        </ContextMenuItem>
      </>
    )

  // 删的列里有原文件就有的列（不是这次在最后加的）才算「中间」；还没问到时先当作是
  const origLast = info?.last
  const delMid = del ? origLast === undefined || del.cols.some((c) => c <= origLast) : false
  const dialogs = (
    <>
      {insert && ctx.header && rows && (
        <ColumnInsertDialog
          anchor={insert.anchor}
          initial={insert.side}
          end={end}
          blocked={blocked}
          header={ctx.header}
          rows={rows}
          fields={ctx.fields}
          optionsFor={ctx.optionsFor}
          onApply={(at, cells) => sheet && ctx.onEdits((e) => colOpIn(e, sheet, { at, n: 1 }, cells))}
          onClose={() => setInsert(null)}
        />
      )}
      <ConfirmDialog
        open={!!del}
        title={
          del && del.cols.length > 1
            ? t('删除 {n} 列？', { n: del.cols.length })
            : t('删除 {col} 列？', { col: del ? colName(del.cols[0]) : '' })
        }
        description={
          del?.filled
            ? t('这几列里有 {n} 个格子有内容，会一起删掉。保存前可以撤销（Ctrl+Z）。', { n: del.filled })
            : t('这几列是空的。保存前可以撤销（Ctrl+Z）。')
        }
        blocked={
          del && delMid && blocked === null
            ? t('正在看这张表能不能删列…')
            : del && delMid && blocked?.length
              ? t('这张表有{what}，删列会让它们指错位置，请在 Excel / WPS 里删。', { what: blocked.join('、') })
              : undefined
        }
        onConfirm={() => {
          if (del) doDelete(del.cols)
          setDel(null)
        }}
        onOpenChange={(o) => !o && setDel(null)}
      />
    </>
  )
  return { menu, dialogs, epoch, openInsert, end }
}

/** 页面上已经做过的列操作一共多了几列（「最后」的位置要跟着算） */
function netCols(ops: ColOp[]) {
  return ops.reduce((n, op) => n + op.n, 0)
}
