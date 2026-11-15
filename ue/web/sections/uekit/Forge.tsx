import { CircleStop, Download, FileCode2, ListFilter, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { ErrorText } from '../../ui.tsx'
import { ForgeDetail, type ForgeTab } from './ForgeDetail.tsx'
import { FILTERS, kindMeta, stateMeta, type FilterId } from './kinds.ts'
import { ListCol, useExtEvents } from './ListCol.tsx'
import { NotInstalled } from './NotInstalled.tsx'
import { FileTree, type TreeLeaf } from './tree.tsx'

/**
 * AssetForge 页（UEKit 扩展，效果图 designs/UEKit-扩展页面-效果图/1、2）：左边是配置根下的 JSON 配置文件树 + 状态筛选，
 * 右边是选中配置导入后生成的资源、计划、属性差异和配置原文。
 * 用户 2026-11-15：左边只列 JSON 配置，没有配置的资源不显示（导出成配置在资源页的「导出到 JSON」）。导入导出是后台作业，进度靠推送事件（forge.job），不轮询。
 * 编辑器没开时这些操作由后台编辑器做（服务端 ops.ts 把 forge.* 当资源操作）。
 */
export interface ForgeEntry {
  key: string
  name: string
  state: string
  needsImport?: boolean
  config?: string
  configPath?: string
  asset?: string
  kind?: string
  revision?: number
  message?: string
}

export interface ForgeJob {
  id: string
  title: string
  mode: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  total: number
  finished: number
  succeeded: number
  failed: number
  skipped?: number
  round?: number
  current?: string
}

/** 树里的路径：配置文件相对配置根的路径（如 umg/UI/WBP_HUD.json），按配置根下的目录分层 */
export function treePath(e: ForgeEntry) {
  return (e.config ?? e.key).replace(/\\/g, '/').replace(/^\//, '')
}

const PAGE = 1000
/** 一次最多拉这么多：再多就按目录筛（forge.entries 每页最多 1000） */
const MAX = 20000

async function loadAll(project: string, deep: boolean) {
  const all: ForgeEntry[] = []
  let total = 0
  let background = false
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const r = await op<{ entries: ForgeEntry[]; total: number; instance?: { kind: string } }>(
      project,
      'forge.entries',
      { unmanaged: false, deep, offset, limit: PAGE },
      undefined,
      deep ? 300000 : 120000,
    )
    all.push(...r.entries)
    total = r.total
    background = r.instance?.kind === 'background'
    if (all.length >= r.total || !r.entries.length) break
  }
  return { entries: all, total, background }
}

export function Forge() {
  const { project, state, sub, go } = useUe()
  const { ui, cn } = h()
  const { busy, run } = useAction()
  const installed = state?.extensions?.some((x) => x.name === 'AssetForge')
  const [data, setData] = useState<{ entries: ForgeEntry[]; total: number; background: boolean }>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [root, setRoot] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterId>('all')
  const [kind, setKind] = useState('')
  const [job, setJob] = useState<ForgeJob>()
  const [tab, setTab] = useState<ForgeTab>()

  const reload = (deep = false) => {
    setLoading(true)
    loadAll(project.id, deep)
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    if (!installed) return
    reload()
    void op<{ configRoot?: string }>(project.id, 'forge.health')
      .then((r) => setRoot(r.configRoot ?? ''))
      .catch(() => undefined)
    // 页面打开时可能已经有作业在跑（Agent 或别的页面发起的）
    void op<{ job?: ForgeJob }>(project.id, 'forge.job')
      .then((r) => r.job?.status === 'running' && setJob(r.job))
      .catch(() => undefined)
    // 换项目、装好扩展时重拉；reload 每次渲染都是新函数
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, installed])

  useExtEvents(project.id, (e) => {
    if (e.event === 'forge.job') {
      const j = e as unknown as ForgeJob & { phase?: string }
      setJob(j)
      if (j.phase === 'finished') reload()
    } else if (e.event === 'forge.changed') reload()
    else if (e.event === 'forge.reveal' && typeof e.asset === 'string') go('assetforge', e.asset)
  })

  const entries = data?.entries ?? []
  const counts = useMemo(
    () => ({
      pending: entries.filter(FILTERS.pending).length,
      changed: entries.filter(FILTERS.changed).length,
      error: entries.filter(FILTERS.error).length,
    }),
    [entries],
  )
  const kinds = useMemo(() => [...new Set(entries.map((e) => e.kind).filter(Boolean) as string[])].sort(), [entries])
  const q = query.trim().toLowerCase()
  const items: TreeLeaf<ForgeEntry>[] = useMemo(
    () =>
      entries
        .filter(FILTERS[filter])
        .filter((e) => !kind || e.kind === kind)
        .filter((e) => !q || `${e.asset ?? ''} ${e.config ?? ''}`.toLowerCase().includes(q))
        .map((e) => ({ path: treePath(e), data: e })),
    [entries, filter, kind, q],
  )
  const selected = entries.find((e) => e.key === sub || e.asset === sub || e.config === sub)
  const running = job?.status === 'running'

  if (state && !installed) return <NotInstalled name="AssetForge" />

  const importPending = () =>
    run('import', async () => {
      const r = await op<{ job?: string }>(project.id, 'forge.import', { pending: true })
      if (!r.job) h().toast.success(t('没有要导入的配置'))
    })

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto ue:md:flex-row ue:md:overflow-hidden">
      <ListCol
        id="forge"
        title="AssetForge"
        count={data?.total ?? '…'}
        query={query}
        onQuery={setQuery}
        placeholder={t('按配置文件或资产路径找')}
        extra={
          <>
            <ui.IconButton
              icon={loading ? Loader2 : RefreshCw}
              size="sm"
              label={t('深度检查：真的演练一遍导入，确认哪些配置会改资产（慢）')}
              disabled={loading}
              onClick={() => reload(true)}
            />
            <ui.Button size="sm" disabled={!counts.pending || running || !!busy} onClick={importPending}>
              <Download className="ue:h-3.5 ue:w-3.5" />
              {t('导入 {n}', { n: counts.pending })}
            </ui.Button>
          </>
        }
        tabs={
          <div className="ue:flex ue:flex-col ue:gap-2">
            <ui.Segmented
              size="sm"
              fill
              label={t('按同步状态筛选')}
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: t('全部') },
                { id: 'pending', label: `${t('待同步')} ${counts.pending}` },
                { id: 'changed', label: `${t('被改过')} ${counts.changed}` },
                { id: 'error', label: `${t('出错')} ${counts.error}` },
              ]}
            />
            {kinds.length > 1 && (
              <label className="ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:text-muted">
                <ListFilter className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
                <ui.Select
                  size="sm"
                  className="ue:flex-1"
                  aria-label={t('资产类型')}
                  value={kind}
                  onChange={(e: { target: { value: string } }) => setKind(e.target.value)}
                  options={[
                    { value: '', label: t('类型：全部 {n} 种', { n: kinds.length }) },
                    ...kinds.map((k) => ({ value: k, label: kindMeta(k).label() })),
                  ]}
                />
              </label>
            )}
          </div>
        }
        footer={
          running && job ? (
            <JobBar job={job} onStop={() => void run('stop', () => op(project.id, 'forge.stop', { id: job.id }))} />
          ) : (
            <span>
              {t('配置根')} <code className="ue:font-mono ue:text-muted">{root || '…'}</code>
              {data?.background && ` · ${t('编辑器没开，在后台编辑器里读')}`}
            </span>
          )
        }
      >
        {error ? (
          <ErrorText>{error}</ErrorText>
        ) : !data ? (
          <div className="ue:flex ue:justify-center ue:p-6 ue:text-subtle">
            <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
          </div>
        ) : (
          <FileTree
            label={t('AssetForge 配置文件')}
            items={items}
            searching={!!q || filter !== 'all' || !!kind}
            active={selected ? treePath(selected) : undefined}
            onOpen={(_p, e) => go('assetforge', e.key)}
            leafIcon={(e) => {
              const m = kindMeta(e.kind)
              return { icon: m.icon, tone: m.tone }
            }}
            leafRight={(e) => {
              if (e.state === 'synced') return null
              const s = stateMeta(e.state)
              return (
                <span className={cn('ue:flex ue:items-center ue:gap-1', s.tone)}>
                  <span className={cn('ue:h-1.5 ue:w-1.5 ue:rounded-full', s.dot)} />
                  {s.label()}
                </span>
              )
            }}
            folderRight={(leaves) => <FolderCount leaves={leaves} />}
            empty={
              <p className="ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
                {entries.length
                  ? t('没有符合筛选的配置')
                  : t('配置根下还没有 JSON 配置：在资源页选中资产，点「导出到 JSON」生成')}
              </p>
            }
          />
        )}
      </ListCol>
      <main className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:overflow-hidden">
        {selected ? (
          <ForgeDetail
            key={selected.key}
            entry={selected}
            busy={running || !!busy}
            configRoot={root}
            tab={tab}
            onTab={setTab}
          />
        ) : (
          <div className="ue:flex ue:flex-1 ue:flex-col ue:items-center ue:justify-center ue:gap-2 ue:p-8 ue:text-center ue:text-footnote ue:text-subtle">
            <FileCode2 className="ue:h-6 ue:w-6" />
            {t('选左边的一份配置，看它导入后生成的资源、导入计划、属性差异和配置原文')}
          </div>
        )}
      </main>
    </div>
  )
}

/** 文件夹右边：有问题的先用彩色数字标出来，再是总数 */
function FolderCount({ leaves }: { leaves: ForgeEntry[] }) {
  const pending = leaves.filter(FILTERS.pending).length
  const changed = leaves.filter(FILTERS.changed).length
  const errors = leaves.filter(FILTERS.error).length
  return (
    <>
      {errors > 0 && <span className="ue:text-danger">{t('{n} 出错', { n: errors })}</span>}
      {pending > 0 && <span className="ue:text-warning">{t('{n} 待导入', { n: pending })}</span>}
      {changed > 0 && <span className="ue:text-accent-text">{t('{n} 被改过', { n: changed })}</span>}
      <span>{leaves.length}</span>
    </>
  )
}

function JobBar({ job, onStop }: { job: ForgeJob; onStop: () => void }) {
  const { ui } = h()
  const pct = job.total ? Math.round((job.finished / job.total) * 100) : 0
  return (
    <>
      <div className="ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:text-fg">
        <Loader2 className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:animate-spin ue:text-warning" />
        <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-medium">{job.title}</span>
        <ui.IconButton icon={CircleStop} size="xs" label={t('停止')} onClick={onStop} />
      </div>
      <div className="ue:h-1 ue:overflow-hidden ue:rounded-full ue:bg-sel">
        <div className="ue:h-full ue:bg-run ue:transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span>
        {job.round ? `${t('第 {n} 轮', { n: job.round })} · ` : ''}
        {job.finished} / {job.total} · <span className="ue:text-success">{t('{n} 成功', { n: job.succeeded })}</span>
        {job.failed > 0 && (
          <>
            {' · '}
            <span className="ue:text-danger">{t('{n} 失败', { n: job.failed })}</span>
          </>
        )}
        {job.current && ` · ${t('正在处理 {name}', { name: job.current.split('/').pop() ?? job.current })}`}
      </span>
    </>
  )
}
