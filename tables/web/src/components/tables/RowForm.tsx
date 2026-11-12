import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { t } from '@shared/i18n'
import type { CellSet } from '@shared/table-edit'
import type { ColInfo, EnumOption } from '@shared/table-struct'
import { cn } from '@/lib/utils'
import { colName } from '@/lib/sheet'
import type { SheetColHead } from '@/components/files/SheetTable'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { ComboInput, Input, Textarea } from '@/components/ui/input'
import { ResizeHandle, usePaneWidth } from '@/components/ui/resize'

/** 格子里的字超过这么长、或者有换行，就用多行输入框 */
const LONG = 48

export interface RowFormField {
  col: number
  info: ColInfo | undefined
  head: SheetColHead | undefined
  /** 表头注释行里这一列写的说明 */
  note: string
  /** 枚举 / 引用能选的值 */
  options?: EnumOption[]
}

/**
 * 一行的表单视图（表格右边的抽屉）：竖着列出「字段名 · 类型标签 · 值」，八十列的宽表也不用横向滚。
 * 显示的是表格里当前格所在的那一行，上下键（Alt+↑↓）或按钮按表格现在的显示顺序（筛选、排序后）切换行，
 * 表格的当前格跟着走；改一个字段离开输入框（或回车）就写进表格，和在格子里改一样能撤销。
 * 枚举、引用列给下拉建议，引用列能点过去；表头注释行的内容显示成字段说明；不合规的字段下面写原因。
 */
export function RowForm({
  row,
  rows,
  from,
  order,
  fields,
  focusCol,
  hidden,
  problemAt,
  dirty,
  readOnly,
  keyCol,
  onCommit,
  onGo,
  onRefJump,
  onClose,
}: {
  /** 表格当前格所在的行；null 或表头行时提示先选一行数据 */
  row: number | null
  rows: string[][]
  from: number
  /** 表格现在显示的数据行（筛选、排序之后），上一行 / 下一行按它走 */
  order: number[]
  fields: RowFormField[]
  focusCol: number | undefined
  hidden: Set<number>
  problemAt: Map<string, string>
  dirty: Set<string>
  readOnly: boolean
  keyCol: number
  onCommit: (cells: CellSet[]) => void
  /** 切到某一行的某一列（表格的当前格跟着走） */
  onGo: (row: number, col: number) => void
  onRefJump: (ref: string, value: string) => void
  onClose: () => void
}) {
  const pane = usePaneWidth('tables-row-form', 380, 280, () => Math.round(window.innerWidth * 0.6))
  const [query, setQuery] = useState('')
  const [filled, setFilled] = useState(false)
  const data = row !== null && row >= from && row < Math.max(rows.length, from + 1)
  const line = data ? (rows[row!] ?? []) : []
  const at = useMemo(() => (data ? order.indexOf(row!) : -1), [data, order, row])
  const step = (d: number) => {
    const next = at >= 0 ? order[at + d] : order[0]
    if (next !== undefined) onGo(next, focusCol ?? Math.max(0, keyCol))
  }
  const q = query.trim().toLowerCase()
  const shown = fields.filter((f) => {
    if (filled && !line[f.col]) return false
    if (!q) return true
    return [f.info?.field, colName(f.col), f.note].some((s) => s?.toLowerCase().includes(q))
  })
  // 表格里换了当前列：表单滚到那个字段
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusCol === undefined) return
    list.current?.querySelector(`[data-col="${focusCol}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focusCol, row])
  const key = keyCol >= 0 ? (line[keyCol] ?? '') : ''
  return (
    <aside
      aria-label={t('一行的表单')}
      style={{ width: pane.width }}
      className="tb:relative tb:flex tb:min-h-0 tb:shrink-0 tb:flex-col tb:border-l tb:bg-panel"
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
        e.preventDefault()
        // 正在改的字段先提交（失焦），再切行
        ;(document.activeElement as HTMLElement | null)?.blur()
        step(e.key === 'ArrowUp' ? -1 : 1)
      }}
    >
      <ResizeHandle pane={pane} />
      <header className="tb:flex tb:h-9 tb:shrink-0 tb:items-center tb:gap-1 tb:border-b tb:pr-1.5 tb:pl-3">
        <span className="tb:min-w-0 tb:truncate tb:text-footnote tb:font-medium">
          {data ? t('第 {n} 行', { n: row! + 1 }) : t('一行的表单')}
          {key && <span className="tb:ml-1.5 tb:font-mono tb:text-subtle">{key}</span>}
        </span>
        {data && at >= 0 && (
          <span className="tb:text-caption tb:text-subtle tb:tabular-nums">
            {at + 1} / {order.length}
          </span>
        )}
        <span className="tb:ml-auto" />
        <IconButton
          icon={ChevronUp}
          label={t('上一行（Alt+↑）')}
          disabled={!data || at <= 0}
          onClick={() => step(-1)}
        />
        <IconButton
          icon={ChevronDown}
          label={t('下一行（Alt+↓）')}
          disabled={!data || at < 0 || at >= order.length - 1}
          onClick={() => step(1)}
        />
        <IconButton icon={X} label={t('关闭表单')} onClick={onClose} />
      </header>
      <div className="tb:flex tb:shrink-0 tb:items-center tb:gap-1.5 tb:border-b tb:px-2 tb:py-1.5">
        <Search className="tb:ml-1 tb:h-3.5 tb:w-3.5 tb:shrink-0 tb:text-subtle" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('按字段名、说明筛')}
          aria-label={t('按字段名、说明筛')}
          className="tb:h-7 tb:min-w-0 tb:flex-1 tb:bg-transparent tb:text-footnote tb:outline-none tb:placeholder:text-subtle"
        />
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={filled}
          className={cn('tb:h-6 tb:shrink-0 tb:px-2 tb:text-caption', filled && 'tb:bg-active tb:text-fg')}
          onClick={() => setFilled(!filled)}
        >
          {t('只看有值的')}
        </Button>
      </div>
      {!data ? (
        <p className="tb:p-4 tb:text-footnote tb:leading-relaxed tb:text-subtle">
          {t('在表格里点一行数据，这里竖着列出它的每个字段，可以直接改。')}
        </p>
      ) : (
        <div ref={list} className="thin-scroll tb:min-h-0 tb:flex-1 tb:overflow-y-auto tb:py-1">
          {shown.map((f) => (
            <FormRow
              key={f.col}
              field={f}
              value={line[f.col] ?? ''}
              current={f.col === focusCol}
              hidden={hidden.has(f.col)}
              problem={problemAt.get(`${row}:${f.col}`)}
              dirty={dirty.has(`${row}:${f.col}`)}
              readOnly={readOnly}
              onFocus={() => f.col !== focusCol && onGo(row!, f.col)}
              onCommit={(v) => onCommit([{ r: row!, c: f.col, v }])}
              onRefJump={onRefJump}
            />
          ))}
          {!shown.length && <p className="tb:px-3 tb:py-4 tb:text-footnote tb:text-subtle">{t('没有对得上的字段')}</p>}
        </div>
      )}
    </aside>
  )
}

/** 一个字段：名字、标签、说明、输入框、不合规的原因。值从外面来，输入时先记在本地，离开或回车才写进表格 */
const FormRow = memo(function FormRow({
  field,
  value,
  current,
  hidden,
  problem,
  dirty,
  readOnly,
  onFocus,
  onCommit,
  onRefJump,
}: {
  field: RowFormField
  value: string
  current: boolean
  hidden: boolean
  problem?: string
  dirty: boolean
  readOnly: boolean
  onFocus: () => void
  onCommit: (v: string) => void
  onRefJump: (ref: string, value: string) => void
}) {
  const { col, info, head, note, options } = field
  const [draft, setDraft] = useState<string | null>(null)
  const v = draft ?? value
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  const id = `row-form-${col}`
  const long = v.length > LONG || v.includes('\n')
  // 键盘和焦点挂在外面一层：ComboInput 自己占着输入框的 onKeyDown / onFocus
  const keys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // 下拉里选中一项时 ComboInput 已经处理了回车（并写进了表格）
    if (e.defaultPrevented) return
    if (e.key === 'Escape' && draft !== null) {
      e.preventDefault()
      e.stopPropagation()
      setDraft(null)
    } else if (e.key === 'Enter') {
      // 多行输入框里回车是换行，Ctrl+回车才提交
      const multi = (e.target as HTMLElement).tagName === 'TEXTAREA'
      if (multi && !e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      commit()
    }
  }
  const refValue = info?.ref && value ? (info.list ? (value.split(info.sep)[0] ?? '').trim() : value.trim()) : ''
  const common = { id, value: v, disabled: readOnly, onBlur: commit, 'aria-invalid': problem ? true : undefined }
  return (
    <div
      data-col={col}
      className={cn(
        'tb:flex tb:flex-col tb:gap-1 tb:px-3 tb:py-2 tb:transition-colors',
        current && 'tb:bg-sel',
        hidden && 'tb:opacity-60',
      )}
    >
      <label htmlFor={id} className="tb:flex tb:min-w-0 tb:items-baseline tb:gap-1.5">
        <span
          className={cn('tb:truncate tb:text-footnote', info?.field ? 'tb:font-medium tb:text-fg' : 'tb:text-subtle')}
        >
          {info?.field || colName(col)}
        </span>
        {info?.field && <span className="tb:shrink-0 tb:font-mono tb:text-caption tb:text-subtle">{colName(col)}</span>}
        {dirty && (
          <span
            aria-label={t('改过')}
            title={t('改过，还没保存')}
            className="tb:h-1.5 tb:w-1.5 tb:shrink-0 tb:self-center tb:rounded-full tb:bg-(--c-grid-edited)"
          />
        )}
        <span className="tb:ml-auto tb:flex tb:min-w-0 tb:shrink tb:gap-1 tb:overflow-hidden">
          {head?.tags.map((g, i) => (
            <span key={i} title={g.title ?? g.text} className={cn('sheet-tag', `sheet-tag-${g.tone}`)}>
              {g.text}
            </span>
          ))}
        </span>
      </label>
      {note && <p className="tb:text-caption tb:leading-snug tb:text-subtle">{note}</p>}
      <div className="tb:flex tb:items-start tb:gap-1">
        <div className="tb:min-w-0 tb:flex-1" onFocus={onFocus} onKeyDown={keys}>
          {options?.length && !readOnly && !info?.list ? (
            <ComboInput
              {...common}
              onChange={setDraft}
              // 从建议里点选：直接写进表格（不用再离开输入框）
              onPick={(x) => {
                setDraft(null)
                if (x !== value) onCommit(x)
              }}
              suggestions={options.map((o) => ({ value: o.name, label: o.desc }))}
              className="tb:h-8 tb:font-mono tb:text-footnote"
            />
          ) : long ? (
            <Textarea
              {...common}
              rows={Math.min(6, Math.max(2, Math.ceil(v.length / 40), v.split('\n').length))}
              onChange={(e) => setDraft(e.target.value)}
              className="tb:text-footnote"
            />
          ) : (
            <Input
              {...common}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={info?.list ? t('多个值用 {sep} 隔开', { sep: info.sep }) : undefined}
              className="tb:h-8 tb:font-mono tb:text-footnote"
            />
          )}
        </div>
        {refValue && (
          <IconButton
            icon={ArrowUpRight}
            label={t('跳到被引用的行')}
            className="tb:mt-1"
            onClick={() => onRefJump(info!.ref!, refValue)}
          />
        )}
      </div>
      {problem && <p className="tb:text-caption tb:leading-snug tb:text-danger">{problem}</p>}
    </div>
  )
})
