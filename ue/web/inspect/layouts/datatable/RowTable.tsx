import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Plus, Table2, Trash2 } from 'lucide-react'
import { h, t } from '../../../host.ts'
import { Card, ErrorText, SearchBox } from '../../../ui.tsx'
import { EntryTable, type EntryCol } from '../shell/EntryTable.tsx'
import { CellView } from './Cells.tsx'
import { nextSort, sortRows, type Sort, type Table, type TableRow } from './model.ts'
import type { TableData } from './use-table.ts'

/**
 * 中间的行表格（效果图 B1 上半）：工具条（行数、行结构、搜索、加行 / 复制 / 删除选中行），表头写列名和 UE 类型，
 * 点列头排序（只在网页里排，不改资源的行顺序），点一行在行编辑器里打开。超过一页时底部翻页
 */
export function RowTable({
  data,
  selected,
  onSelect,
  sort,
  onSort,
  onRows,
}: {
  data: TableData
  selected: string
  onSelect: (row: string) => void
  sort: Sort
  onSort: (s: Sort) => void
  /** 加行 / 复制 / 删除：交给布局问名字、确认 */
  onRows: (action: 'add' | 'duplicate' | 'remove', row?: string) => void
}) {
  const { ui } = h()
  const d = data.table
  const rows = sortRows(d?.rows ?? [], sort)
  const mark = (col: string) =>
    sort?.col === col ? (
      sort.desc ? (
        <ArrowDown className="ue:h-3 ue:w-3 ue:text-accent-text" />
      ) : (
        <ArrowUp className="ue:h-3 ue:w-3 ue:text-accent-text" />
      )
    ) : undefined
  const cols: EntryCol<TableRow>[] = [
    {
      key: '__name',
      head: t('行名'),
      sub: 'FName',
      mono: true,
      onHead: () => onSort(nextSort(sort, '')),
      mark: mark(''),
      cell: (r) => <span className="ue:whitespace-nowrap">{r.name}</span>,
    },
    ...(d?.columns ?? []).map((c): EntryCol<TableRow> => ({
      key: c.name,
      head: c.name,
      sub: c.type,
      num: /^(int|uint|float|double)/.test(c.type),
      onHead: () => onSort(nextSort(sort, c.name)),
      mark: mark(c.name),
      cell: (r) => <CellView value={r.values[c.name]} type={c.type} />,
    })),
  ]
  return (
    <Card
      className="ue:min-h-0 ue:flex-1"
      title={
        <>
          <Table2 className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
          {t('行')}
          {d && (
            <span className="ue:text-footnote ue:font-normal ue:text-subtle">
              {t('{n} 行 · 行结构 {s}', { n: d.total, s: d.struct })}
            </span>
          )}
        </>
      }
      aside={
        <>
          <div className="ue:w-64">
            <SearchBox placeholder={t('搜行名、任意列的值')} allowEmpty onSearch={data.setFilter} busy={data.loading} />
          </div>
          <ui.IconButton icon={Plus} label={t('加一行')} size="sm" onClick={() => onRows('add')} />
          <ui.IconButton
            icon={Copy}
            label={t('复制选中行')}
            size="sm"
            disabled={!selected}
            onClick={() => onRows('duplicate', selected)}
          />
          <ui.IconButton
            icon={Trash2}
            label={t('删除选中行')}
            size="sm"
            tone="danger"
            disabled={!selected}
            onClick={() => onRows('remove', selected)}
          />
        </>
      }
      bodyClass="ue:flex ue:min-h-0 ue:flex-col"
    >
      {data.error && (
        <div className="ue:px-4 ue:pt-2">
          <ErrorText>{data.error}</ErrorText>
        </div>
      )}
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto">
        {d ? (
          <EntryTable
            rows={rows}
            cols={cols}
            rowKey={(r) => r.name}
            selected={selected}
            onSelect={onSelect}
            index={(r) => indexOf(d, r) + 1}
            empty={t('没有匹配的行')}
          />
        ) : (
          !data.error && <p className="ue:p-4 ue:text-footnote ue:text-subtle">{t('读取中…')}</p>
        )}
      </div>
      {d && data.pages > 1 && (
        <footer className="ue:flex ue:items-center ue:justify-end ue:gap-2 ue:border-t ue:border-line ue:px-4 ue:py-1.5 ue:text-footnote ue:text-subtle">
          {t('第 {p} / {n} 页', { p: data.page + 1, n: data.pages })}
          <ui.IconButton
            icon={ChevronLeft}
            label={t('上一页')}
            size="xs"
            disabled={data.page === 0}
            onClick={() => data.setPage(data.page - 1)}
          />
          <ui.IconButton
            icon={ChevronRight}
            label={t('下一页')}
            size="xs"
            disabled={data.page + 1 >= data.pages}
            onClick={() => data.setPage(data.page + 1)}
          />
        </footer>
      )}
    </Card>
  )
}

/** 序号是资源里的行顺序（排序后也不变，方便对照 UE 编辑器） */
const indexOf = (d: Table & { offset: number }, r: TableRow) => d.rows.indexOf(r) + d.offset
