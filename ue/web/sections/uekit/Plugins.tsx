import { CircleArrowUp, Loader2, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DiagItem } from '../../../server/editor-tools/diagnose.ts'
import { pget, ppost, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { MenuHost } from '../../menu.tsx'
import { STACK } from '../../split.tsx'
import { Confirm, ErrorText, PageHead } from '../../ui.tsx'
import { DiagPanel } from './LinkDiagnose.tsx'
import { CardsSection } from './plugins/CardsSection.tsx'
import { JobBar, useJob } from './plugins/JobBar.tsx'
import { StrayBuilds } from './plugins/StrayBuilds.tsx'
import { extView, isStale, upgradePlan, uelinkView, type PluginView } from './plugins/model.ts'
import { NotesModal } from './plugins/NotesModal.tsx'
import { isSettingsPlugin, PluginSettings } from './plugins/PluginSettings.tsx'
import { StatusStrip } from './plugins/StatusStrip.tsx'
import { Todos } from './plugins/Todos.tsx'
import { useExtList } from './plugins/use-ext-list.ts'

/**
 * UE 插件页：UEKit 插件库（UELink 和挂在它上面的 AssetForge、GameTest）在这个项目里的安装情况。
 * 2026-11-16 用户嫌一长条一长条的不合理，按设计稿 designs/UE插件管理页重设计-设计稿.md 重做：
 * 顶上状态条（诊断入口），「要处理」，卡片网格（没装的也列），页底作业条；页头「全部升级」按依赖顺序一次升完再编译。
 * 打开页面只看服务端缓存，点「检查更新」才去 GitHub（用户定的长期规则）。
 */
export type InstallMode = 'local' | 'vcs'
export interface PluginActions {
  busy: string
  install: (v: PluginView, mode?: InstallMode) => void
  build: () => void
  open: (v: PluginView) => void
  uninstall: (v: PluginView) => void
  notes: (v: PluginView) => void
  /** 打开这个插件自己的设置页 */
  settings: (v: PluginView) => void
}

/** 地址 plugins/<插件名> 是那个插件的设置页，其余是插件列表 */
export function Plugins() {
  const { sub } = useUe()
  return isSettingsPlugin(sub) ? <PluginSettings name={sub} /> : <PluginList />
}

function PluginList() {
  const { project, state, reload, go } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const [jobId, setJobId] = useState('')
  const [removing, setRemoving] = useState<PluginView>()
  const [notesOf, setNotesOf] = useState<PluginView>()
  const [diag, setDiag] = useState<{ items: DiagItem[]; at: string }>()
  const { list, checking, check } = useExtList(project.id, reload)
  // 没有自己起的作业时显示这个项目最近一个装卸 / 编译作业
  const latest = jobId || state?.jobs.filter((j) => j.kind !== 'background' && j.kind !== 'editor').at(-1)?.id || ''
  const job = useJob(latest)
  const link = useMemo(() => uelinkView(project, state, list.data), [project, state, list.data])
  const exts = useMemo(() => (list.data?.items ?? []).map((x) => extView(x, link)), [list.data, link])
  const plan = upgradePlan(link, exts)
  const running = job.data?.status === 'running'

  const started = (id: string) => {
    setJobId(id)
    reload()
  }
  const mode = (v: PluginView, m?: InstallMode): InstallMode =>
    m ?? (v.installed?.mode === 'vcs' || (!v.installed && project.install?.mode === 'vcs') ? 'vcs' : 'local')
  const actions: PluginActions = {
    busy,
    install: (v, m) =>
      void run(`install-${v.name}`, async () => {
        if (v.base) {
          // UELink 走原来的安装接口：装完服务端自己起一次编译，作业条跟编译
          const r = await ppost<{ job: string; build?: string }>(project.id, 'install', {
            mode: mode(v, m),
            prerelease: v.offer?.pre,
          })
          return started(r.build ?? r.job)
        }
        const r = await ppost<{ job: string }>(project.id, 'ext/upgrade-all', {
          title: v.installed ? t('升级 {name}', { name: v.displayName }) : t('安装 {name}', { name: v.displayName }),
          uelink: v.withUELink ? { prerelease: link.offer?.pre ?? '' } : undefined,
          extensions: [{ name: v.name, version: v.offer?.version, mode: mode(v, m) }],
          build: false,
        })
        started(r.job)
      }),
    build: () => void build(),
    open: (v) => go(v.name === 'AssetForge' ? 'assetforge' : 'gametest'),
    uninstall: setRemoving,
    notes: setNotesOf,
    settings: (v) => go('plugins', v.name),
  }
  const build = (opts?: 'force' | 'kill' | 'killStale') =>
    run('build', async () => {
      const r = await ppost<{ job: string }>(project.id, 'build', opts ? { [opts]: true } : undefined)
      started(r.job)
    })
  const upgradeAll = () =>
    run('upgrade-all', async () => {
      const r = await ppost<{ job: string }>(project.id, 'ext/upgrade-all', {
        title: t('全部升级'),
        uelink: plan.uelink,
        extensions: plan.extensions,
        build: true,
      })
      started(r.job)
    })
  const uninstall = (v: PluginView) =>
    run(`uninstall-${v.name}`, async () => {
      const r = await ppost<{ job: string }>(project.id, v.base ? 'uninstall' : 'ext/uninstall', { name: v.name })
      started(r.job)
    })
  const diagnose = () => run('diag', async () => setDiag(await pget(project.id, 'tools/diagnose')))

  const err = list.error || list.data?.error
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead
        title={t('UE 插件')}
        desc={t('UEKit 插件库：装进项目的 Plugins/，装完要完整编译一次；界面和 Agent 工具都在面板里')}
      >
        <ui.Button size="sm" variant="secondary" disabled={checking || running} onClick={() => void check()}>
          {checking ? (
            <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
          ) : (
            <RefreshCw className="ue:h-3.5 ue:w-3.5" />
          )}
          {t('检查更新')}
        </ui.Button>
        {(plan.count > 0 || (running && job.data?.steps)) && (
          <ui.Button size="sm" disabled={!!busy || running} onClick={() => void upgradeAll()}>
            {running && job.data?.steps ? (
              <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
            ) : (
              <CircleArrowUp className="ue:h-3.5 ue:w-3.5" />
            )}
            {running && job.data?.steps
              ? t('升级中 {i}/{n}…', {
                  i: job.data.steps.filter((s) => s.status !== 'wait').length,
                  n: job.data.steps.length,
                })
              : t('全部升级 · {n}', { n: plan.count })}
          </ui.Button>
        )}
      </PageHead>
      <div className={STACK}>
        <StatusStrip
          project={project}
          state={state}
          source={list.data?.source}
          checkedAt={list.data?.checkedAt}
          unchecked={list.data?.unchecked}
          diagBusy={busy === 'diag'}
          diagOpen={!!diag}
          onDiagnose={() => void diagnose()}
        />
        {diag && (
          <DiagPanel
            res={diag}
            busy={!!busy}
            onClose={() => setDiag(undefined)}
            onAction={(a) =>
              a === 'launch'
                ? void run('launch', async () => {
                    await ppost(project.id, 'editor')
                    reload()
                  })
                : a === 'build'
                  ? void build()
                  : actions.install(link)
            }
          />
        )}
        {err && (
          <div className="ue:bg-card ue:p-4">
            <ErrorText>
              {t('读不到插件目录：{e}。可以在插件设置里把「UEKit 插件目录」换成镜像或本机目录', { e: err })}
            </ErrorText>
          </div>
        )}
        <Todos
          unchecked={list.data?.unchecked}
          legacy={link.legacy}
          stale={[link, ...exts].filter(isStale)}
          busy={!!busy || running}
          onBuild={() => void build()}
        />
        <CardsSection
          link={link}
          exts={exts}
          job={job.data}
          engine={project.engine.version}
          vcs={project.vcs !== 'none'}
          actions={actions}
        />
        {job.data && (
          <JobBar
            job={job}
            onDone={() => {
              setJobId('')
              list.reload()
              reload()
            }}
            onBuild={(m) => void build(m)}
            onJob={started}
          />
        )}
        <StrayBuilds job={job.data} onJob={started} />
      </div>
      <MenuHost />
      {notesOf && <NotesModal view={notesOf} onClose={() => setNotesOf(undefined)} />}
      <Confirm
        open={!!removing}
        title={t('卸载 {name}', { name: removing?.displayName ?? '' })}
        okText={t('卸载')}
        danger
        onOk={() => {
          if (removing) void uninstall(removing)
          setRemoving(undefined)
        }}
        onCancel={() => setRemoving(undefined)}
      >
        {removing?.base
          ? t(
              '删掉项目里的 Plugins/UELink。UEToVS 也用它，删了 UEToVS 也连不上；编辑器开着时 DLL 被占用删不掉，先关编辑器。',
            )
          : t('删掉项目里的 {dir}。配置和场景文件不动；编辑器开着时 DLL 被占用删不掉，先关编辑器。', {
              dir: removing?.installed?.rel ?? '',
            })}
      </Confirm>
    </div>
  )
}
