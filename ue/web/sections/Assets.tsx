import { ChevronLeft, ChevronRight, Copy, ExternalLink, Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { op, show, useAction, useLoad } from '../api.ts'
import { useAsk } from '../ask.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Props } from '../Props.tsx'
import { Badge, Card, Confirm, ErrorText, Note, PageHead, SearchBox, kindLabel } from '../ui.tsx'

interface AssetRow {
  path: string
  name: string
  class: string
  package: string
}
interface Table {
  struct: string
  columns: { name: string; type: string; complex: boolean }[]
  rows: { name: string; values: Record<string, unknown> }[]
  total: number
  dirty: boolean
  instance?: { pid: number; kind: string }
}
interface Dirty {
  package: string
  file: string
  readOnly: boolean
}

const CLASSES = [
  '',
  'DataTable',
  'PrimaryDataAsset',
  'DataAsset',
  'Blueprint',
  'CurveTable',
  'CurveFloat',
  'StringTable',
]
const PAGE = 50

/**
 * 资源（图 5）：按类型和名字前缀找资源（点搜索才搜）；DataTable 表格视图（分页、筛选、改单元格、增删行），
 * DataAsset、蓝图默认值（CDO）用属性面板。编辑器关着时走后台编辑器，读的是磁盘上的版本。
 * 改动只暂存在编辑器里，「签出并保存」才写回（P4 先签出）
 */
export function Assets() {
  const { project, sub, go, state } = useUe()
  const { cn, ui, toast } = h()
  const { busy, run } = useAction()
  const [cls, setCls] = useState('DataTable')
  const [q, setQ] = useState<{ cls: string; prefix: string }>()
  const found = useLoad(
    () =>
      q
        ? op<{
            items: AssetRow[]
            total: number
            instance: { kind: string }
            searched?: { path: string; prefix: string }
          }>(project.id, 'assets', { class: q.cls, prefix: q.prefix, path: '/Game', limit: 200 }, undefined, 15 * 60000)
        : Promise.resolve(undefined),
    [q],
  )
  const dirty = useLoad(
    () =>
      (state?.instances ?? []).some((i) => i.kind === 'editor' || i.kind === 'background')
        ? op<{ items: Dirty[] }>(project.id, 'asset.dirty').then((r) => r.items)
        : Promise.resolve([]),
    [project.id, (state?.instances ?? []).length],
  )
  const [confirmSave, setConfirmSave] = useState(false)
  const selected = (found.data?.items ?? []).find((a) => a.path === sub)
  const isTable = selected ? selected.class === 'DataTable' : /\/DT_/.test(sub)
  const source = found.data?.instance?.kind

  const save = () =>
    run('save', async () => {
      setConfirmSave(false)
      await op(project.id, 'asset.save', { packages: (dirty.data ?? []).map((d) => d.package) }, undefined, 120000)
      toast.success(t('已保存'))
      void dirty.reload()
    })
  const revert = () =>
    run('revert', async () => {
      await op(project.id, 'asset.revert', { packages: (dirty.data ?? []).map((d) => d.package) }, undefined, 120000)
      toast.success(t('已放弃改动'))
      void dirty.reload()
    })

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead
        title={t('资源')}
        desc={
          source
            ? t('来源：{src}', {
                src: source === 'background' ? t('后台编辑器（磁盘上保存的版本）') : kindLabel(source),
              })
            : t('编辑器没开时自动起后台编辑器读取')
        }
      >
        {!!dirty.data?.length && (
          <>
            <Badge tone="warn">{t('{n} 个资源改了没保存', { n: dirty.data.length })}</Badge>
            <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void revert()}>
              {t('放弃改动')}
            </ui.Button>
            <ui.Button size="sm" disabled={!!busy} onClick={() => setConfirmSave(true)}>
              {project.vcs === 'p4' ? t('签出并保存') : t('保存')}
            </ui.Button>
          </>
        )}
      </PageHead>
      <div className="ue:grid ue:min-h-0 ue:flex-1 ue:gap-4 ue:overflow-auto ue:p-6 ue:lg:grid-cols-[minmax(260px,1fr)_minmax(420px,2.6fr)] ue:lg:overflow-hidden">
        <Card bodyClass="ue:flex ue:min-h-0 ue:flex-col">
          <div className="ue:flex ue:flex-col ue:gap-2 ue:border-b ue:border-line ue:p-3">
            <ui.Select
              size="sm"
              value={cls}
              onChange={(e: { target: { value: string } }) => setCls(e.target.value)}
              options={CLASSES.map((c) => ({ value: c, label: c || t('所有类型') }))}
            />
            <SearchBox
              placeholder={t('资源名开头（DT_Item），或目录（/Game/Data、磁盘上 Content 里的路径）')}
              hint={t('前缀')}
              allowEmpty={!!cls}
              onSearch={(p) => setQ({ cls, prefix: p })}
              busy={found.loading}
            />
            {found.loading &&
              state &&
              !state.instances.some((i) => i.kind !== 'background') &&
              !state.background.running && (
                <Note tone="info">{t('UE 没在运行，正在启动后台编辑器，第一次要 30–60 秒…')}</Note>
              )}
            <ErrorText>{found.error}</ErrorText>
            {found.data && found.data.total > found.data.items.length && (
              <span className="ue:text-footnote ue:text-subtle">
                {t('共 {n} 个，只列前 {m} 个', { n: found.data.total, m: found.data.items.length })}
              </span>
            )}
          </div>
          <ul className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:p-1.5">
            {(found.data?.items ?? []).map((a) => (
              <li key={a.path}>
                <button
                  type="button"
                  onClick={() => go('assets', a.path)}
                  className={cn(
                    'ue:flex ue:w-full ue:cursor-pointer ue:flex-col ue:rounded-lg ue:px-2.5 ue:py-1.5 ue:text-left ue:hover:bg-hover',
                    sub === a.path && 'ue:bg-sel',
                  )}
                >
                  <span className="ue:flex ue:items-center ue:gap-2">
                    <span className="ue:truncate ue:text-body ue:text-fg">{a.name}</span>
                    <span className="ue:ml-auto ue:shrink-0 ue:text-caption ue:text-subtle">{a.class}</span>
                  </span>
                  <span className="ue:truncate ue:text-caption ue:text-subtle">{a.package}</span>
                </button>
              </li>
            ))}
            {!q && (
              <li className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">
                {t('选类型，输入名字开头或目录，点「搜索」')}
              </li>
            )}
            {found.data && !found.data.items.length && (
              <li className="ue:p-4 ue:text-center ue:text-footnote ue:text-subtle">
                {t('没有找到')}
                {found.data.searched && (
                  <span className="ue:mt-1 ue:block ue:font-mono ue:break-all">
                    {found.data.searched.prefix
                      ? t('在 {path} 下找名字以 {prefix} 开头的', found.data.searched)
                      : t('在 {path} 下找', found.data.searched)}
                  </span>
                )}
              </li>
            )}
          </ul>
        </Card>
        <Card bodyClass="ue:flex ue:min-h-0 ue:flex-col">
          {!sub ? (
            <p className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">
              {t('选一个资源：DataTable 显示成表格，DataAsset 和蓝图显示默认值')}
            </p>
          ) : isTable ? (
            <DataTableView key={sub} path={sub} onChanged={() => void dirty.reload()} />
          ) : (
            <Props
              key={sub}
              path={sub}
              onOpen={(p) => go('assets', p)}
              readOnlyHint={t('资源的改动只暂存在编辑器里，点右上「保存」才写回文件；蓝图资源改的是类默认值')}
            />
          )}
        </Card>
      </div>
      <Confirm
        open={confirmSave}
        title={project.vcs === 'p4' ? t('签出并保存这些资源？') : t('保存这些资源？')}
        okText={project.vcs === 'p4' ? t('签出并保存') : t('保存')}
        onOk={() => void save()}
        onCancel={() => setConfirmSave(false)}
      >
        <ul className="ue:flex ue:flex-col ue:gap-1 ue:font-mono ue:text-footnote">
          {(dirty.data ?? []).map((d) => (
            <li key={d.package} className="ue:break-all">
              {d.file}
              {d.readOnly ? ` · ${t('只读，会先签出')}` : ''}
            </li>
          ))}
        </ul>
        {project.vcs === 'p4' && (
          <p className="ue:mt-2 ue:text-footnote ue:text-subtle">{t('P4 签出进默认变更列表，不会提交')}</p>
        )}
      </Confirm>
    </div>
  )
}

/** DataTable 表格：行号、行名、各列；结构体列显示摘要；点行展开全部字段；双击单元格改值 */
function DataTableView({ path, onChanged }: { path: string; onChanged: () => void }) {
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
      onChanged()
    })
  const rows = (action: string, row: string, to?: string) =>
    run(action, async () => {
      await op(project.id, 'datatable.rows', { path, action, row, to })
      toast.success(t('已修改，未保存'))
      void data.reload()
      onChanged()
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
                            e.stopPropagation()
                            setEdit({ row: r.name, col: c.name })
                          }}
                          className="ue:max-w-56 ue:border-b ue:border-line/60 ue:px-2 ue:py-1 ue:font-mono ue:text-fg"
                          title={c.complex ? show(r.values[c.name]) : t('双击修改')}
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
                      <span className="ue:flex ue:opacity-0 ue:group-hover:opacity-100">
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
  return (
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
  )
}
