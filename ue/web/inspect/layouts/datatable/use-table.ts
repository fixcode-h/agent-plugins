import { useState } from 'react'
import { op, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import type { Table } from './model.ts'

export const PAGE = 200

export interface TableData {
  table?: Table & { offset: number }
  error: string
  loading: boolean
  page: number
  pages: number
  setPage: (p: number) => void
  setFilter: (f: string) => void
  reload: () => void
}

/**
 * 数据表的行（UELink datatable：列名和类型、当前页的行、总数）。一页 200 行，搜索是 UELink 那边筛（行名开头或任一列包含）；
 * 按资源记住结果，切视图回来先显示上次的
 */
export function useTable(path: string): TableData {
  const { project } = useUe()
  const [filter, setFilterRaw] = useState('')
  const [page, setPage] = useState(0)
  const data = useLoad(
    () =>
      op<Table>(
        project.id,
        'datatable',
        { path, filter, offset: page * PAGE, limit: PAGE },
        undefined,
        15 * 60000,
      ).then((r) => ({ ...r, path, offset: page * PAGE })),
    [project.id, path, filter, page],
    0,
    `${project.id}/dt/rows`,
  )
  const table = data.data?.path === path ? data.data : undefined
  return {
    table,
    error: data.error,
    loading: data.loading,
    page,
    pages: table ? Math.max(1, Math.ceil(table.total / PAGE)) : 1,
    setPage,
    setFilter: (f) => {
      setFilterRaw(f)
      setPage(0)
    },
    reload: () => void data.reload(),
  }
}
