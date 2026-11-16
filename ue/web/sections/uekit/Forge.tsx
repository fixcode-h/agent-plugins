import { Download, Ellipsis, FileJson, FilePlus2, Loader2, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useToChat } from '../../chat.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { MenuHost } from '../../menu.tsx'
import { PathText } from '../../path-text.tsx'
import { ErrorText } from '../../ui.tsx'
import { ForgeDetail, type ForgeTab } from './ForgeDetail.tsx'
import { ForgeEmpty, forgeEmptyKind } from './ForgeEmpty.tsx'
import { JobBar, JobResult } from './ForgeJobBar.tsx'
import { ForgeJobReport } from './ForgeJobReport.tsx'
import { ForgeMulti } from './ForgeMulti.tsx'
import { ForgeAiEdit } from './ForgeAiEdit.tsx'
import { ForgeNew, makeDirOf, type ForgeNewInit } from './ForgeNew.tsx'
import { saveAsTemplate, type ForgeFileOps } from './forge-file-ops.ts'
import { canImport, forgeMenus } from './forge-menus.ts'
import { useForgePick } from './forge-pick.ts'
import { useForgeSource } from './forge-source.ts'
import { useForgeFileWatch } from './forge-watch.ts'
import { FILTERS, kindMeta, stateMeta, type FilterId } from './kinds.ts'
import { ListCol, useExtEvents } from './ListCol.tsx'
import { NotInstalled } from './NotInstalled.tsx'
import { FileTree, type ExpandSignal, type FolderLabel, type TreeLeaf } from './tree.tsx'

/**
 * AssetForge 页（UEKit 扩展，设计稿 designs/AssetForge页重设计-设计稿.md）：左边是配置根下的 JSON 配置文件树，
 * 第一层是按类型分的子目录（显示成类型名 + dir/），能多选、右键；右边是选中配置生成的资源、属性差异、导入计划、配置原文，
 * 多选时是多选摘要，作业跑完点「查看」是作业报告。
 * 用户 2026-11-15：左边只列 JSON 配置，没有配置的资源不显示（导出成配置在资源页的「导出到 JSON」）。导入导出是后台作业，进度靠推送事件（forge.job），不轮询。
 * 编辑器没开时这些操作由后台编辑器做（服务端 ops.ts 把 forge.* 当资源操作）。
 * 用户 2026-11-16：配置根打开页面就自动建好；能从内置模板新建配置，也能把需求交给 Agent 写，写好自动打开预览（ForgeNew.tsx）。
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

type JobWithReports = ForgeJob & { reports?: unknown[] }

/** 树里的路径：配置文件相对配置根的路径（如 umg/UI/WBP_HUD.json），按配置根下的目录分层 */
export function treePath(e: ForgeEntry) {
  return (e.config ?? e.key).replace(/\\/g, '/').replace(/^\//, '')
}

export function Forge() {
  const { project, state, sub, go } = useUe()
  const { ui, cn, toast } = h()
  const { busy, run } = useAction()
  const installed = state?.extensions?.some((x) => x.name === 'AssetForge')
  const { data, error, loading, health, dirKinds, reload } = useForgeSource(project.id, installed)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterId>('all')
  // 正在跑的，或跑完还没被关掉的作业（底部显示结果）；report 是点「查看」取回的带 reports 的那份
  const [job, setJob] = useState<ForgeJob>()
  const [report, setReport] = useState<JobWithReports>()
  // 右栏页签由这里控制：只对记下时选中的那份生效，换了选中项就回到 undefined，由右栏按状态挑默认页签
  const [tabOf, setTabOf] = useState<{ key: string; tab: ForgeTab }>()
  const [expand, setExpand] = useState<ExpandSignal>()
  // 选中的配置存盘了几次（forge.file 推送）：右栏据此重拉差异、重新演练
  const [fileRev, setFileRev] = useState(0)
  const configRoot = health?.configRoot ?? ''
  // 「新建配置」弹窗：打开时带的预填（类型、资产目录、模式）
  const [newInit, setNewInit] = useState<ForgeNewInit>()
  // 交给 Agent 写的那份配置（相对配置根）：存盘后自动选中打开
  const [awaiting, setAwaiting] = useState<string>()
  const chat = useToChat()
  // 「让 AI 改…」弹窗：对哪份配置
  const [aiEdit, setAiEdit] = useState<ForgeEntry>()
  const dirOf = useMemo(() => makeDirOf(dirKinds), [dirKinds])

  useEffect(() => {
    if (!installed) return
    // 页面打开时可能已经有作业在跑（Agent 或别的页面发起的）
    void op<{ job?: ForgeJob }>(project.id, 'forge.job')
      .then((r) => r.job?.status === 'running' && setJob(r.job))
      .catch(() => undefined)
  }, [project.id, installed])

  const selected = data?.entries.find(
    (e) => e.key === sub || e.asset === sub || (!!e.config && !!sub && samePath(e.config, sub)),
  )
  // 等 Agent 写配置时盯那一份（还不存在，服务端盯它所在的目录）；没在等就盯右栏选中的
  useForgeFileWatch(project.id, configRoot, awaiting ?? selected?.config)

  useExtEvents(project.id, (e) => {
    if (e.event === 'forge.job') {
      const j = e as unknown as ForgeJob & { phase?: string }
      // 新作业开始：上一次的结果和报告到此为止
      if (j.phase === 'started') setReport(undefined)
      setJob(j)
      if (j.phase === 'finished') reload()
    } else if (e.event === 'forge.changed') reload()
    else if (e.event === 'forge.reveal' && typeof e.asset === 'string') go('assetforge', e.asset)
    else if (e.event === 'forge.file' && awaiting && samePath(String(e.path ?? ''), awaiting)) {
      if (e.missing) return
      // Agent 把配置写出来了：刷新清单、选中它，右栏按配置预览（资源还没生成）
      setAwaiting(undefined)
      reload()
      go('assetforge', awaiting)
      toast.success(t('Agent 写好了 {p}', { p: awaiting }))
    } else if (e.event === 'forge.file' && selected?.config && samePath(String(e.path ?? ''), selected.config)) {
      // 编辑器或 Agent 存了右栏这份配置：同步状态会变（被改过），清单和右栏一起刷新
      reload()
      setFileRev((n) => n + 1)
    }
  })

  const entries = useMemo(() => data?.entries ?? [], [data])
  const counts = useMemo(
    () => ({
      pending: entries.filter(FILTERS.pending).length,
      changed: entries.filter(FILTERS.changed).length,
      error: entries.filter(FILTERS.error).length,
    }),
    [entries],
  )
  // 列表先从磁盘出、UE 还没回同步状态：各状态的数先显示「…」，不显示成 0 让人以为都同步了
  const statesUnknown = entries.some((e) => !e.state)
  const num = (n: number) => (statesUnknown ? '…' : n)
  const q = query.trim().toLowerCase()
  const items: TreeLeaf<ForgeEntry>[] = useMemo(
    () =>
      entries
        .filter(FILTERS[filter])
        .filter((e) => !q || `${e.asset ?? ''} ${e.config ?? ''}`.toLowerCase().includes(q))
        .map((e) => ({ path: treePath(e), data: e })),
    [entries, filter, q],
  )
  const pick = useForgePick(selected)
  const pickedEntries = useMemo(() => entries.filter((e) => pick.picked.includes(e.key)), [entries, pick.picked])
  const pickedPaths = useMemo(() => new Set(pickedEntries.map(treePath)), [pickedEntries])
  const running = job?.status === 'running'
  const locked = running || !!busy

  const open = (e: ForgeEntry, tab?: ForgeTab) => {
    pick.clear(e.key)
    setReport(undefined)
    setTabOf(tab ? { key: e.key, tab } : undefined)
    go('assetforge', e.key)
  }
  const openKey = (key: string) => {
    const e = entries.find((x) => x.key === key)
    if (e) open(e)
  }
  const importConfigs = (args: Record<string, unknown>) =>
    run('import', async () => {
      const r = await op<{ job?: string }>(project.id, 'forge.import', args)
      if (!r.job) toast.success(t('没有要导入的配置'))
    })
  const exportAssets = (assets: string[]) =>
    run('export', () => op(project.id, 'forge.export', { assets }).then(() => undefined))
  const viewReport = () =>
    job &&
    run('report', async () => {
      const r = await op<{ job?: JobWithReports }>(project.id, 'forge.job', { id: job.id, reports: 50 })
      if (r.job) setReport(r.job)
    })
  const expandAll = (openAll: boolean, under?: string) =>
    setExpand((x) => ({ open: openAll, under, n: (x?.n ?? 0) + 1 }))

  const fileOps: ForgeFileOps = {
    copy: (e) => setNewInit({ from: { config: (e.config ?? '').replace(/\\/g, '/'), kind: e.kind, asset: e.asset } }),
    aiEdit: chat.available ? setAiEdit : undefined,
    saveTemplate: (e) => void saveAsTemplate(project.id, configRoot, e),
  }
  /** 资产路径 → 已经管着它的配置：新建时不让两份配置写同一个资产 */
  const managedBy = (asset: string) => {
    const a = asset.toLowerCase()
    return entries.find((e) => e.config && e.asset && e.asset.replace(/\.[^/]*$/, '').toLowerCase() === a)?.config
  }

  const menus = forgeMenus({
    project: project.id,
    configRoot,
    entries,
    picked: pick.picked,
    locked,
    importConfigs: (configs, dryRun) => void importConfigs({ configs, ...(dryRun ? { dryRun: true } : {}) }),
    exportAssets: (assets) => void exportAssets(assets),
    open,
    reload,
    expand: expandAll,
    go,
    newConfig: (init) => setNewInit(init ?? {}),
    dirKinds,
    fileOps,
  })

  if (state && !installed) return <NotInstalled name="AssetForge" />

  const pickedConfigs = pickedEntries.filter(canImport).map((e) => e.config!)
  const multi = pickedEntries.length > 1
  const folderLabel = (path: string, depth: number): FolderLabel | undefined => {
    const kind = depth === 0 ? dirKinds.get(path) : undefined
    if (!kind) return undefined
    const m = kindMeta(kind)
    return {
      icon: m.icon,
      tone: m.tone,
      label: (
        <>
          {m.label()} <span className="ue:font-mono ue:text-caption ue:font-normal ue:text-subtle">{path}/</span>
        </>
      ),
    }
  }
  const emptyKind = forgeEmptyKind(health, entries.length)
  const empty = (compact: boolean) => (
    <ForgeEmpty
      kind={emptyKind}
      root={configRoot}
      compact={compact}
      onReveal={menus.revealRoot}
      onAssets={() => go('assets')}
      onNew={(mode) => setNewInit({ mode })}
      canAi={chat.available}
      createError={health?.createError}
    />
  )

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:overflow-auto ue:md:flex-row ue:md:overflow-hidden">
      <ListCol
        id="forge"
        title="AssetForge"
        count={data?.total ?? '…'}
        query={query}
        onQuery={setQuery}
        placeholder={t('按配置文件或资产路径找')}
        onBodyMenu={menus.bodyMenu}
        searchExtra={
          <ui.IconButton
            icon={FilePlus2}
            size="sm"
            label={t('新建配置：从模板或让 AI 写')}
            disabled={!configRoot}
            onClick={() => setNewInit({})}
          />
        }
        extra={
          <>
            <ui.IconButton
              icon={loading ? Loader2 : RefreshCw}
              size="sm"
              label={t('刷新：重新读一遍同步清单（快）')}
              disabled={!!loading}
              onClick={() => reload(false)}
            />
            <ui.IconButton icon={Ellipsis} size="sm" label={t('更多')} onClick={menus.moreMenu} />
            <ui.Button
              size="sm"
              disabled={locked || (multi ? !pickedConfigs.length : !counts.pending)}
              onClick={() => void importConfigs(multi ? { configs: pickedConfigs } : { pending: true })}
            >
              <Download className="ue:h-3.5 ue:w-3.5" />
              {multi ? t('导入 {n} 份', { n: pickedConfigs.length }) : t('导入 {n}', { n: counts.pending })}
            </ui.Button>
          </>
        }
        tabs={
          <ui.Segmented
            size="sm"
            fill
            label={t('按同步状态筛选')}
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: t('全部') },
              { id: 'pending', label: `${t('待导入')} ${num(counts.pending)}` },
              { id: 'changed', label: `${t('被改过')} ${num(counts.changed)}` },
              { id: 'error', label: `${t('出错')} ${num(counts.error)}` },
            ]}
          />
        }
        footer={
          <>
            {running && job ? (
              <JobBar job={job} onStop={() => void run('stop', () => op(project.id, 'forge.stop', { id: job.id }))} />
            ) : (
              job && <JobResult job={job} viewing={!!report} onView={() => void viewReport()} />
            )}
            {loading === 'deep' && <span>{t('正在深度检查：演练一遍全部导入，比较慢')}</span>}
            {data?.statesPending && loading === 'quick' && (
              <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
                <Loader2 className="ue:h-3 ue:w-3 ue:shrink-0 ue:animate-spin" />
                {t('正在向 UE 读同步状态（编辑器没开时要先启动后台编辑器）')}
              </span>
            )}
            {error && data && <ErrorText>{t('同步状态没读到：{e}', { e: error })}</ErrorText>}
            {awaiting && (
              <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-fg">
                <Loader2 className="ue:h-3 ue:w-3 ue:shrink-0 ue:animate-spin ue:text-subtle" />
                <span className="ue:shrink-0">{t('等 Agent 写')}</span>
                <PathText path={awaiting} tail={2} copy={false} className="ue:text-muted" />
                <ui.IconButton
                  icon={X}
                  size="sm"
                  className="ue:ml-auto ue:shrink-0"
                  label={t('不等了')}
                  onClick={() => setAwaiting(undefined)}
                />
              </span>
            )}
            {/* 配置根一行：路径太长时省略前面的目录，鼠标移上去看全、点一下复制（用户 2026-11-16：原来溢出被截） */}
            <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
              <span className="ue:shrink-0">{t('配置根')}</span>
              {configRoot ? (
                <PathText path={configRoot} tail={2} className="ue:text-muted" />
              ) : (
                <span className="ue:text-muted">…</span>
              )}
              {health?.configRootExists && (
                <button
                  type="button"
                  onClick={menus.revealRoot}
                  className="ue:ml-auto ue:shrink-0 ue:cursor-pointer ue:text-accent-text ue:hover:underline"
                >
                  {t('打开')}
                </button>
              )}
            </span>
            {data?.background && <span>{t('编辑器没开，在后台编辑器里读')}</span>}
          </>
        }
      >
        {error && !data ? (
          <ErrorText>{error}</ErrorText>
        ) : !data ? (
          <div className="ue:flex ue:justify-center ue:p-6 ue:text-subtle">
            <Loader2 className="ue:h-4 ue:w-4 ue:animate-spin" />
          </div>
        ) : (
          <FileTree
            label={t('AssetForge 配置文件')}
            items={items}
            searching={!!q || filter !== 'all'}
            active={selected && !multi ? treePath(selected) : undefined}
            onOpen={(_p, e) => open(e)}
            picked={multi ? pickedPaths : undefined}
            onPick={pick.onPick}
            expand={expand}
            folderLabel={folderLabel}
            onLeafMenu={menus.leafMenu}
            onFolderMenu={menus.folderMenu}
            leafIcon={(e) => ({ icon: FileJson, tone: kindMeta(e.kind).tone })}
            leafRight={(e) => {
              // 已同步不标；还没读到状态的也先不标，免得一排「正在读状态」
              if (!e.state || e.state === 'synced') return null
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
              entries.length ? (
                <p className="ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
                  {t('没有符合筛选的配置')}
                </p>
              ) : (
                empty(true)
              )
            }
          />
        )}
      </ListCol>
      <main className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col ue:overflow-hidden">
        {report ? (
          <ForgeJobReport
            job={report}
            entries={entries}
            onOpen={openKey}
            onClose={() => {
              setReport(undefined)
              setJob(undefined)
            }}
          />
        ) : multi ? (
          <ForgeMulti entries={pickedEntries} busy={locked} onOpen={openKey} />
        ) : selected ? (
          <ForgeDetail
            key={selected.key}
            entry={selected}
            busy={locked}
            configRoot={configRoot}
            tab={tabOf?.key === selected.key ? tabOf.tab : undefined}
            fileRev={fileRev}
            onTab={(tab) => setTabOf({ key: selected.key, tab })}
            fileOps={fileOps}
          />
        ) : (
          data && empty(false)
        )}
      </main>
      {newInit && (
        <ForgeNew
          project={project.id}
          configRoot={configRoot}
          dirOf={dirOf}
          init={newInit}
          canAi={chat.available}
          managedBy={managedBy}
          onClose={() => setNewInit(undefined)}
          onOpenConfig={(config) => {
            setNewInit(undefined)
            go('assetforge', config)
          }}
          onExport={(asset) => {
            // 已经存在的资产：先导出成配置纳管（导出是后台作业，跑完左栏会出现这份配置）
            setNewInit(undefined)
            void exportAssets([asset])
          }}
          onCreated={(config) => {
            setNewInit(undefined)
            toast.success(t('已新建 {p}', { p: config }))
            reload()
            go('assetforge', config)
          }}
          onAi={(prompt, config) => {
            setNewInit(undefined)
            setAwaiting(config)
            chat.send(prompt)
          }}
        />
      )}
      {aiEdit && (
        <ForgeAiEdit
          entry={aiEdit}
          configRoot={configRoot}
          onClose={() => setAiEdit(undefined)}
          onSend={(prompt) => {
            setAiEdit(undefined)
            // 右栏盯着选中的配置：先选中它，Agent 存盘后差异和计划自动刷新
            open(aiEdit)
            chat.send(prompt)
          }}
        />
      )}
      {chat.dialog}
      <MenuHost />
    </div>
  )
}

const samePath = (a: string, b: string) =>
  a.replace(/\\/g, '/').replace(/^\//, '').toLowerCase() === b.replace(/\\/g, '/').replace(/^\//, '').toLowerCase()

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
