import { Blocks, Download, FileCode2, FlaskConical, Loader2, RefreshCw, Trash2, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { Job } from '../../../server/types.ts'
import type { ExtensionStatus } from '../../../server/uekit/catalog.ts'
import { canUpgrade } from '../../../server/semver.ts'
import { get, pget, ppost, useAction, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { STACK } from '../../split.tsx'
import { UELinkCard } from './UELinkCard.tsx'
import { Badge, Card, Confirm, ErrorText, PageHead, Term } from '../../ui.tsx'

/**
 * UE 插件页：UEKit 插件库里 UELink 的扩展（AssetForge、GameTest）在这个项目里装没装、能不能升级，
 * 一键安装 / 升级 / 卸载（服务端 uekit/install-ext.ts）。最上面是 UELink 本身（UELinkCard，服务端仍是 install.ts）。
 */
const ICONS: Record<string, LucideIcon> = { AssetForge: FileCode2, GameTest: FlaskConical }

export function Plugins() {
  const { project, reload, go } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const [refresh, setRefresh] = useState(0)
  const [jobId, setJobId] = useState('')
  const [removing, setRemoving] = useState<ExtensionStatus>()
  // 打开页面只看服务端缓存，不自动去 GitHub；点「检查更新」才重读，读完刷新概况（UELink 卡片的「可升级」跟着变）
  const list = useLoad(
    () =>
      pget<{ items: ExtensionStatus[]; error?: string; unchecked?: boolean }>(
        project.id,
        `ext${refresh ? '?refresh=1' : ''}`,
      ).then((r) => {
        if (refresh) reload()
        return r
      }),
    [project.id, refresh],
  )
  const job = useLoad(() => (jobId ? get<Job>(`/jobs/${jobId}`) : Promise.resolve(undefined)), [jobId])
  const done = (r: { job: string }) => {
    setJobId(r.job)
    list.reload()
    reload()
  }
  const install = (x: ExtensionStatus, mode: 'local' | 'vcs') =>
    run(`install-${x.name}`, () =>
      ppost<{ job: string }>(project.id, 'ext/install', { name: x.name, version: x.offer?.version, mode }).then(done),
    )
  const needPre = list.data?.items.find((x) => x.offer?.uelink && !x.installed)?.offer?.uelink
  const build = () =>
    run('build', async () => {
      await ppost(project.id, 'build')
      reload()
    })
  const uninstall = (x: ExtensionStatus) =>
    run(`uninstall-${x.name}`, () => ppost<{ job: string }>(project.id, 'ext/uninstall', { name: x.name }).then(done))

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead
        title={t('UE 插件')}
        desc={t(
          'UEKit 插件库：UELink 让面板连上 UE，AssetForge、GameTest 等扩展挂在它上面。都装进项目的 Plugins/，界面在这里，Agent 也能用',
        )}
      >
        <ui.Button size="sm" variant="secondary" disabled={list.loading} onClick={() => setRefresh((n) => n + 1)}>
          {list.loading ? (
            <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
          ) : (
            <RefreshCw className="ue:h-3.5 ue:w-3.5" />
          )}
          {t('检查更新')}
        </ui.Button>
      </PageHead>
      <div className={STACK}>
        {(list.error || list.data?.error) && (
          <div className="ue:p-4">
            <ErrorText>
              {t('读不到插件目录：{e}。可以在插件设置里把「UEKit 插件目录」换成镜像或本机目录', {
                e: list.error || list.data?.error || '',
              })}
            </ErrorText>
          </div>
        )}
        {list.data?.unchecked && (
          <p className="ue:px-4 ue:pt-3 ue:text-footnote ue:text-subtle">
            {t('还没检查 UEKit 插件目录，点右上角「检查更新」从 GitHub 读取最新版本。')}
          </p>
        )}
        <UELinkCard needPre={needPre} onChanged={() => list.reload()} />
        {(list.data?.items ?? []).map((x) => {
          const Icon = ICONS[x.name] ?? Blocks
          const upgrade = !!x.installed && !!x.offer && canUpgrade(x.installed.version, x.offer.version)
          const notLoaded = x.installed && x.loaded && x.loaded !== x.installed.version
          const blocked = (x.offer?.blockers.length ?? 0) > 0
          return (
            <Card
              key={x.name}
              title={
                <>
                  <span className="ue:flex ue:h-7 ue:w-7 ue:items-center ue:justify-center ue:rounded-lg ue:bg-accent-soft ue:text-accent-text">
                    <Icon className="ue:h-4 ue:w-4" strokeWidth={1.75} />
                  </span>
                  {x.displayName}
                </>
              }
              aside={
                <>
                  {x.installed ? (
                    <Badge tone={upgrade ? 'warn' : 'ok'}>{x.installed.version}</Badge>
                  ) : (
                    <Badge>{t('未安装')}</Badge>
                  )}
                  {x.offer?.prerelease && <Badge tone="run">{t('预发布')}</Badge>}
                </>
              }
            >
              <div className="ue:flex ue:flex-col ue:gap-2.5 ue:px-4 ue:py-3">
                {x.description && <p className="ue:text-body ue:leading-relaxed ue:text-muted">{x.description}</p>}
                <p className="ue:text-footnote ue:text-subtle">
                  {x.installed
                    ? t('装在 {dir}（{mode}）', {
                        dir: x.installed.rel,
                        mode: x.installed.mode === 'vcs' ? t('已加入版本管理') : t('只在本机'),
                      })
                    : x.offer
                      ? t('可以装 {v}', { v: x.offer.version })
                      : t('插件目录里还没有发布的版本')}
                  {upgrade && ` · ${t('有新版本 {v}', { v: x.offer!.version })}`}
                  {notLoaded && ` · ${t('编辑器里加载的还是 {v}：编译后重启编辑器生效', { v: x.loaded! })}`}
                </p>
                {blocked && !x.installed && (
                  <ul className="ue:list-disc ue:pl-5 ue:text-footnote ue:text-warning">
                    {x.offer!.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                <div className="ue:flex ue:flex-wrap ue:gap-2">
                  {x.offer && (!x.installed || upgrade) && (
                    <>
                      <ui.Button size="sm" disabled={!!busy || blocked} onClick={() => install(x, 'local')}>
                        <Download className="ue:h-3.5 ue:w-3.5" />{' '}
                        {upgrade ? t('升级（只在本机）') : t('安装（只在本机）')}
                      </ui.Button>
                      {project.vcs !== 'none' && (
                        <ui.Button
                          size="sm"
                          variant="secondary"
                          disabled={!!busy || blocked}
                          onClick={() => install(x, 'vcs')}
                        >
                          {upgrade ? t('升级并加入版本管理') : t('安装并加入版本管理')}
                        </ui.Button>
                      )}
                    </>
                  )}
                  {x.installed && x.known && (
                    <ui.Button
                      size="sm"
                      variant="secondary"
                      onClick={() => go(x.name === 'AssetForge' ? 'assetforge' : 'gametest')}
                    >
                      {t('打开')}
                    </ui.Button>
                  )}
                  {x.installed && (
                    <ui.Button size="sm" variant="danger-outline" disabled={!!busy} onClick={() => setRemoving(x)}>
                      <Trash2 className="ue:h-3.5 ue:w-3.5" /> {t('卸载')}
                    </ui.Button>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
        {job.data && (
          <Card
            title={job.data.title}
            aside={
              <Badge tone={job.data.status === 'done' ? 'ok' : 'danger'}>
                {job.data.status === 'done' ? t('完成') : t('失败')}
              </Badge>
            }
          >
            <div className="ue:p-4">
              <Term className="ue:max-h-60">
                {job.data.log.map((l, i) => (
                  <div key={i} className="ue:whitespace-pre-wrap">
                    {l}
                  </div>
                ))}
              </Term>
              {job.data.status === 'done' && (
                <div className="ue:mt-3 ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:text-muted">
                  {t('要完整编译一次才能用：')}
                  <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void build()}>
                    {t('去编译')}
                  </ui.Button>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
      <Confirm
        open={!!removing}
        title={t('卸载 {name}', { name: removing?.displayName ?? '' })}
        okText={t('卸载')}
        danger
        onOk={() => {
          if (removing) uninstall(removing)
          setRemoving(undefined)
        }}
        onCancel={() => setRemoving(undefined)}
      >
        {t('删掉项目里的 {dir}。配置和场景文件不动；编辑器开着时 DLL 被占用删不掉，先关编辑器。', {
          dir: removing?.installed?.rel ?? '',
        })}
      </Confirm>
    </div>
  )
}
