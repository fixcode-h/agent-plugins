import { ChevronLeft, ChevronRight, Copy, ExternalLink, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { op, show, useAction, useLoad } from './api.ts'
import { useAsk } from './ask.tsx'
import { useToChat } from './chat.tsx'
import { useUe } from './ctx.tsx'
import { h, t } from './host.ts'
import { Badge, ErrorText, SearchBox } from './ui.tsx'

interface Table {
  struct: string
  columns: { name: string; type: string; complex: boolean }[]
  rows: { name: string; values: Record<string, unknown> }[]
  total: number
  dirty: boolean
  instance?: { pid: number; kind: string }
}
const PAGE = 50

/**
 * DataTable 表格：行号、行名、各列；结构体列显示摘要；点行展开全部字段；双击单元格改值。
 * 资源页和对话里点 .uasset 弹出的查看窗口（AssetFile.tsx）共用；viewOnly 时只看不改（查看窗口里没有保存、放弃改动的地方）
 */
export function DataTableView({
  path,
  onChanged,
  viewOnly,
}: {
  path: string
  onChanged?: () => void
  viewOnly?: boolean
}) {
  const { project } = useUe()
  const { cn, ui, toast } = h()
  const { busy, run } = useAction()
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState('')
  const [edit, setEdit] = useState<{ row: string; col: string }>()
  const data = useLoad(
    () => op<Table>(project.id, 'datatable', { path, filter, offset: page * PAGE, limit: PAGE }, undefined, 15 * 60000),
    [path, filter, page],
  )
  const d = data.data
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1

  const setCell = (row: string, col: string, raw: string) =>
    run(`${row}.${col}`, async () => {
      let value: unknown = raw
      if (/^[[{]/.test(raw.trim()))
        try {
          value = JSON.parse(raw)
        } catch {
          // 按 UE 文本格式交给桥接
        }
      await op(project.id, 'datatable.set', { path, row, column: col, value })
      setEdit(undefined)
      void data.reload()
      onChanged?.()
    })
  const rows = (action: string, row: string, to?: string) =>
    run(action, async () => {
      await op(project.id, 'datatable.rows', { path, action, row, to })
      toast.success(t('已修改，未保存'))
      void data.reload()
      onChanged?.()
    })
  const [dialog, ask] = useAsk()

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      {dialog}
      <header className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2.5">
        <span className="ue:font-mono ue:text-body ue:font-medium ue:text-fg">
          {path.split('/').pop()?.split('.')[0]}
        </span>
        {d && <Badge>{d.struct}</Badge>}
        {d && <span className="ue:text-footnote ue:text-subtle">{t('{n} 行', { n: d.total })}</span>}
        {d?.dirty && <Badge tone="warn">{t('未保存')}</Badge>}
        <div className="ue:ml-auto ue:flex ue:items-center ue:gap-1">
          {!viewOnly && (
            <ui.IconButton
              icon={Plus}
              label={t('加一行')}
            size="sm"
            disabled={!!busy}
            onClick={() =>
              void ask({ title: t('加一行'), label: t('新行名') }).then((n) => {
                  if (n) void rows('add', n)
                })
              }
            />
          )}
          <ui.IconButton
            icon={ExternalLink}
            label={t('在编辑器里打开')}
            size="sm"
            onClick={() => void run('open', () => op(project.id, 'asset.open', { path }, { instance: 'editor' }))}
          />
        </div>
      </header>
      <div className="ue:px-4 ue:pt-3">
        <SearchBox
          placeholder={t('行名开头，或任一单元格包含的文字')}
          allowEmpty
          onSearch={(f) => {
            setFilter(f)
            setPage(0)
          }}
          busy={data.loading}
        />
      </div>
      <div className="ue:px-4 ue:pt-2">
        <ErrorText>{data.error}</ErrorText>
      </div>
      <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:px-4 ue:py-3">
        {d && (
          <table className="ue:w-full ue:border-separate ue:border-spacing-0 ue:text-footnote">
            <thead className="ue:sticky ue:top-0 ue:z-10 ue:bg-card">
              <tr>
                <th className="ue:border-b ue:border-line ue:px-2 ue:py-1.5 ue:text-left ue:font-medium ue:text-subtle">
                  #
                </th>
                <th className="ue:border-b ue:border-line ue:px-2 ue:py-1.5 ue:text-left ue:font-medium ue:text-subtle">
                  {t('行名')}
                </th>
                {d.columns.map((c) => (
                  <th
                    key={c.name}
                    title={c.type}
                    className="ue:border-b ue:border-line ue:px-2 ue:py-1.5 ue:text-left ue:font-medium ue:whitespace-nowrap ue:text-subtle"
                  >
                    {c.name}
                  </th>
                ))}
                <th className="ue:border-b ue:border-line" />
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, i) => (
                <FragmentRow key={r.name}>
                  <tr
                    className={cn('ue:group ue:cursor-pointer ue:hover:bg-hover', open === r.name && 'ue:bg-sel')}
                    onClick={() => setOpen(open === r.name ? '' : r.name)}
                  >
                    <td className="ue:border-b ue:border-line/60 ue:px-2 ue:py-1 ue:text-subtle">
                      {page * PAGE + i + 1}
                    </td>
                    <td className="ue:border-b ue:border-line/60 ue:px-2 ue:py-1 ue:font-mono ue:whitespace-nowrap ue:text-fg">
                      {r.name}
                    </td>
                    {d.columns.map((c) => {
                      const editing = edit?.row === r.name && edit.col === c.name
                      return (
                        <td
                          key={c.name}
                          onDoubleClick={(e) => {
                            if (viewOnly) return
                            e.stopPropagation()
                            setEdit({ row: r.name, col: c.name })
                          }}
                          className="ue:max-w-56 ue:border-b ue:border-line/60 ue:px-2 ue:py-1 ue:font-mono ue:text-fg"
                          title={c.complex || viewOnly ? show(r.values[c.name]) : t('双击修改')}
                        >
                          {editing ? (
                            <form
                              onClick={(e) => e.stopPropagation()}
                              onSubmit={(e) => {
                                e.preventDefault()
                                void setCell(r.name, c.name, String(new FormData(e.currentTarget).get('v') ?? ''))
                              }}
                            >
                              <input
                                name="v"
                                autoFocus
                                defaultValue={show(r.values[c.name])}
                                onBlur={() => setEdit(undefined)}
                                onKeyDown={(e) => e.key === 'Escape' && setEdit(undefined)}
                                className="ue:h-6 ue:w-full ue:rounded ue:border ue:border-focus ue:bg-field ue:px-1 ue:outline-none"
                              />
                            </form>
                          ) : (
                            <span className={cn('ue:block ue:truncate', c.complex && 'ue:text-muted')}>
                              {show(r.values[c.name])}
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td
                      className="ue:border-b ue:border-line/60 ue:px-1 ue:whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className={cn('ue:flex ue:opacity-0 ue:group-hover:opacity-100', viewOnly && 'ue:hidden')}>
                        <ui.IconButton
                          icon={Copy}
                          label={t('复制这一行')}
                          size="2xs"
                          onClick={() =>
                            void ask({ title: t('复制这一行'), label: t('新行名'), init: `${r.name}_Copy` }).then(
                              (n) => {
                                if (n) void rows('duplicate', r.name, n)
                              },
                            )
                          }
                        />
                        <ui.IconButton
                          icon={Trash2}
                          tone="danger"
                          label={t('删除这一行')}
                          size="2xs"
                          onClick={() =>
                            void ask({
                              title: t('删除行 {r}？保存前可以放弃改动', { r: r.name }),
                              okText: t('删除'),
                              danger: true,
                            }).then((v) => {
                              if (v !== undefined) void rows('remove', r.name)
                            })
                          }
                        />
                      </span>
                    </td>
                  </tr>
                  {open === r.name && (
                    <tr>
                      <td colSpan={d.columns.length + 3} className="ue:border-b ue:border-line ue:bg-panel">
                        <RowDetail path={path} row={r.name} />
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              ))}
            </tbody>
          </table>
        )}
        {d && !d.rows.length && (
          <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">{t('没有匹配的行')}</p>
        )}
      </div>
      {d && pages > 1 && (
        <footer className="ue:flex ue:items-center ue:justify-end ue:gap-2 ue:border-t ue:border-line ue:px-4 ue:py-2 ue:text-footnote ue:text-subtle">
          {t('第 {p} / {n} 页', { p: page + 1, n: pages })}
          <ui.IconButton
            icon={ChevronLeft}
            label={t('上一页')}
            size="xs"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          />
          <ui.IconButton
            icon={ChevronRight}
            label={t('下一页')}
            size="xs"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
          />
        </footer>
      )}
    </div>
  )
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>
}

/** 展开的一行：全部字段（结构体、数组按 JSON 展开） */
function RowDetail({ path, row }: { path: string; row: string }) {
  const { project } = useUe()
  const chat = useToChat()
  const data = useLoad(
    () => op<{ props: { name: string; type: string; value: unknown }[] }>(project.id, 'datatable.row', { path, row }),
    [path, row],
  )
  if (data.error)
    return (
      <div className="ue:p-3">
        <ErrorText>{data.error}</ErrorText>
      </div>
    )
  const props = data.data?.props ?? []
  // 「发给对话」（界面优化第 16 条）：数据表路径、行名和这一行的全部字段
  const describe = () =>
    [
      `${t('UE 数据表')} ${path}`,
      `${t('行')} ${row}`,
      '```json',
      JSON.stringify(Object.fromEntries(props.map((p) => [p.name, p.value])), null, 2),
      '```',
    ].join('\n')
  return (
    <div className="ue:flex ue:flex-col">
      {chat.available && data.data && (
        <div className="ue:flex ue:justify-end ue:px-3 ue:pt-2">
          <LinkBtnChat onClick={() => chat.send(describe())} />
        </div>
      )}
      <dl className="ue:grid ue:grid-cols-[minmax(120px,auto)_1fr] ue:gap-x-4 ue:gap-y-1 ue:p-3 ue:text-footnote">
        {(data.data?.props ?? []).map((p) => (
          <div key={p.name} className="ue:contents">
            <dt className="ue:text-muted" title={p.type}>
              {p.name}
            </dt>
            <dd className="ue:font-mono ue:break-all ue:whitespace-pre-wrap ue:text-fg">
              {typeof p.value === 'object' ? JSON.stringify(p.value, null, 1) : show(p.value)}
            </dd>
          </div>
        ))}
      </dl>
      {chat.dialog}
    </div>
  )
}

function LinkBtnChat({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1 ue:text-footnote ue:text-accent-text ue:hover:underline"
    >
      <MessageSquare className="ue:h-3 ue:w-3" /> {t('发给对话')}
    </button>
  )
}
