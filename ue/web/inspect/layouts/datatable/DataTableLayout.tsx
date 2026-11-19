import { Info, Table2 } from 'lucide-react'
import { useState } from 'react'
import { op, useAction } from '../../../api.ts'
import { useAsk } from '../../../ask.tsx'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { Badge, Card } from '../../../ui.tsx'
import { InfoView, useAssetTab } from '../common.tsx'
import { AssetHead } from '../shell/AssetHead.tsx'
import { LayoutShell } from '../shell/LayoutShell.tsx'
import type { LayoutProps } from '../types.ts'
import { sortRows, stepRow, type Sort } from './model.ts'
import { RowEditor } from './RowEditor.tsx'
import { RowRefs } from './RowRefs.tsx'
import { RowTable } from './RowTable.tsx'
import { useTable } from './use-table.ts'

/**
 * 数据表的查看页（设计稿第 3 节、效果图 B1）：页头（名字、DataTable · 行结构、表格 / 摘要与引用）、
 * 中间行表格、下面行编辑器、右边引用。加行、复制、删除、改行名走 datatable.rows，改值走 datatable.set，都只改内存（资源页头保存）
 */
export function DataTableLayout({ path, onOpen, onChanged, layout }: LayoutProps) {
  const { project } = useUe()
  const { toast } = h()
  const [view, setView] = useAssetTab()
  const tab = view === 'info' ? 'info' : ''
  const data = useTable(path)
  const [picked, setPicked] = useState({ path, row: '' })
  const row = picked.path === path ? picked.row : ''
  const [sort, setSort] = useState<Sort>()
  const { run } = useAction()
  const [dialog, ask] = useAsk()
  const changed = () => onChanged?.()
  const pick = (r: string) => setPicked({ path, row: r })

  const rowsOp = (action: string, r: string, to?: string) =>
    run(action, async () => {
      await op(project.id, 'datatable.rows', { path, action, row: r, to })
      toast.success(t('已修改，未保存'))
      data.reload()
      changed()
      pick(action === 'remove' ? '' : (to ?? r))
    })
  const onRows = (action: 'add' | 'duplicate' | 'remove', r?: string) => {
    if (action === 'add') void ask({ title: t('加一行'), label: t('新行名') }).then((n) => n && void rowsOp('add', n))
    else if (action === 'duplicate' && r)
      void ask({ title: t('复制这一行'), label: t('新行名'), init: `${r}_Copy` }).then(
        (n) => n && void rowsOp('duplicate', r, n),
      )
    else if (action === 'remove' && r)
      void ask({ title: t('删除行 {r}？保存前可以放弃改动', { r }), okText: t('删除'), danger: true }).then(
        (v) => v !== undefined && void rowsOp('remove', r),
      )
  }
  const rename = (r: string) =>
    void ask({ title: t('重命名行'), label: t('新行名'), init: r }).then(
      (n) => n && n !== r && void rowsOp('rename', r, n),
    )

  const head = (
    <AssetHead
      path={path}
      icon={Table2}
      badges={
        <>
          <Badge>DataTable</Badge>
          {data.table && <Badge>{data.table.struct}</Badge>}
          {data.table?.dirty && <Badge tone="warn">{t('未保存')}</Badge>}
        </>
      }
      views={[
        { id: '', label: t('表格'), icon: Table2 },
        { id: 'info', label: t('摘要与引用'), icon: Info },
      ]}
      view={tab}
      onView={(v) => setView(v)}
    />
  )
  if (tab === 'info')
    return (
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
        {head}
        <Card className="ue:min-h-0 ue:flex-1" bodyClass="ue:flex ue:min-h-0 ue:flex-col ue:overflow-auto">
          <InfoView path={path} onOpen={onOpen} />
        </Card>
      </div>
    )
  const shown = sortRows(data.table?.rows ?? [], sort)
  return (
    <>
      {dialog}
      <LayoutShell
        layout={layout}
        head={head}
        center={<RowTable data={data} selected={row} onSelect={pick} sort={sort} onSort={setSort} onRows={onRows} />}
        regions={{
          editor: (
            <RowEditor
              path={path}
              row={row}
              struct={data.table?.struct}
              onStep={(dir) => {
                const next = stepRow(shown, row, dir)
                if (next) pick(next)
              }}
              onRename={rename}
              onOpen={onOpen}
              onChanged={() => {
                data.reload()
                changed()
              }}
            />
          ),
          refs: <RowRefs path={path} onOpen={onOpen} />,
        }}
      />
    </>
  )
}
