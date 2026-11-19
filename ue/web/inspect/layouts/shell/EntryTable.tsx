import type { ReactNode } from 'react'
import { h } from '../../../host.ts'

export interface EntryCol<R> {
  key: string
  head: ReactNode
  /** 列头下面一行小字（数据表写 UE 类型：FName、int32） */
  sub?: string
  cell: (row: R, index: number) => ReactNode
  /** 数字列右对齐 */
  num?: boolean
  mono?: boolean
  /** 列头可点（排序）：给了才有按钮 */
  onHead?: () => void
  /** 列头当前的排序箭头 */
  mark?: ReactNode
  className?: string
}

/**
 * 条目表格（数据表的行、枚举的条目、结构体的成员、曲线的关键帧共用，效果图 B1 / B8 / B9）：
 * 左边序号、表头吸顶、点一行选中（右栏 / 下面显示它的细节），选中行左边一道强调色。只管画，数据和选中由布局给
 */
export function EntryTable<R>({
  rows,
  cols,
  rowKey,
  selected,
  onSelect,
  index = (_r, i) => i,
  empty,
  rowTail,
}: {
  rows: R[]
  cols: EntryCol<R>[]
  rowKey: (r: R, i: number) => string
  selected?: string
  onSelect?: (key: string) => void
  /** 序号列显示什么（翻页时加上偏移） */
  index?: (r: R, i: number) => ReactNode
  empty?: ReactNode
  /** 行尾悬停才出现的按钮 */
  rowTail?: (r: R, i: number) => ReactNode
}) {
  const { cn } = h()
  const th =
    'ue:border-b ue:border-line ue:px-2 ue:py-1 ue:text-left ue:align-bottom ue:font-medium ue:whitespace-nowrap'
  const td = 'ue:border-b ue:border-line/60 ue:px-2 ue:py-1 ue:align-middle'
  return (
    <table className="ue:w-full ue:border-separate ue:border-spacing-0 ue:text-footnote">
      <thead className="ue:sticky ue:top-0 ue:z-10 ue:bg-card">
        <tr>
          <th className={cn(th, 'ue:w-8 ue:text-right ue:text-subtle')}>#</th>
          {cols.map((c) => (
            <th key={c.key} className={cn(th, c.num && 'ue:text-right', 'ue:text-fg')}>
              {c.onHead ? (
                <button
                  type="button"
                  onClick={c.onHead}
                  className="ue:inline-flex ue:cursor-pointer ue:items-center ue:gap-1 ue:hover:text-accent-text"
                >
                  {c.head}
                  {c.mark}
                </button>
              ) : (
                c.head
              )}
              {c.sub && (
                <span className="ue:block ue:font-mono ue:text-caption ue:font-normal ue:text-subtle">{c.sub}</span>
              )}
            </th>
          ))}
          {rowTail && <th className={th} />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const k = rowKey(r, i)
          const on = selected === k
          return (
            <tr
              key={k}
              aria-selected={on}
              onClick={() => onSelect?.(k)}
              className={cn('ue:group', onSelect && 'ue:cursor-pointer', on ? 'ue:bg-sel' : 'ue:hover:bg-hover')}
            >
              <td
                className={cn(
                  td,
                  'ue:w-8 ue:border-l-2 ue:text-right ue:font-mono ue:text-caption ue:text-subtle',
                  on ? 'ue:border-l-accent' : 'ue:border-l-transparent',
                )}
              >
                {index(r, i)}
              </td>
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={cn(td, 'ue:text-fg', c.num && 'ue:text-right', c.mono && 'ue:font-mono', c.className)}
                >
                  {c.cell(r, i)}
                </td>
              ))}
              {rowTail && (
                <td className={cn(td, 'ue:w-px ue:px-1 ue:whitespace-nowrap')} onClick={(e) => e.stopPropagation()}>
                  <span className="ue:flex ue:opacity-0 ue:group-hover:opacity-100 ue:focus-within:opacity-100">
                    {rowTail(r, i)}
                  </span>
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
      {!rows.length && empty && (
        <tbody>
          <tr>
            <td colSpan={cols.length + 2} className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">
              {empty}
            </td>
          </tr>
        </tbody>
      )}
    </table>
  )
}
