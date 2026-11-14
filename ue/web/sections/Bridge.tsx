import { Download, Hammer, Loader2, Square, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Job, UeProject } from '../../server/types.ts'
import { get, post, ppost, useAction, useLoad } from '../api.ts'
import { STACK } from '../split.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Badge, Card, Confirm, PageHead, Term } from '../ui.tsx'
import { BuildHint } from './BuildHint.tsx'
import { canUpgrade } from '../../server/semver.ts'

/**
 * 桥接与权限：UE 端插件 UELink（和 UEToVS 共用）的安装、升级、编译、卸载和输出；Agent 权限；GM 预设存哪；引擎目录和编译命令；从 UE 页移除项目
 */
export function Bridge() {
  const { project, state, reload } = useUe()
  const { ui, toast, hooks } = h()
  const route = hooks.usePluginRoute()
  const { busy, run } = useAction()
  const [jobId, setJobId] = useState('')
  const [form, setForm] = useState(project)
  const [removing, setRemoving] = useState(false)
  useEffect(() => {
    setForm(project)
  }, [project])
  const latest = jobId || state?.jobs.at(-1)?.id || ''
  const job = useLoad(() => (latest ? get<Job>(`/jobs/${latest}`) : Promise.resolve(undefined)), [latest], 1500)
  const installed = state?.bridge
  const upgrade = canUpgrade(installed, state?.bundled)
  // 旧版桥接（AgentPanelBridge 1.x）：升级时会换成 UELink 并删掉旧插件
  const legacy = !!installed && canUpgrade(installed, '2.0.0')
  const live = (state?.instances ?? []).some((i) => i.kind === 'editor')

  const saveSettings = (patch: Partial<UeProject>) =>
    run('settings', async () => {
      await ppost(project.id, 'settings', patch)
      toast.success(t('已保存'))
      reload()
    })
  const act = (what: 'install' | 'uninstall' | 'build', body?: unknown) =>
    run(what, async () => {
      const r = await ppost<{ job: string; build?: string }>(project.id, what, body)
      setJobId(r.build ?? r.job)
      reload()
    })

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('桥接与权限')} desc={project.root} />
      <div className={STACK}>
        <Card
          title={t('UE 端插件 UELink')}
          aside={installed ? <Badge tone={upgrade ? 'warn' : 'ok'}>{installed}</Badge> : <Badge>{t('未安装')}</Badge>}
        >
          <div className="ue:flex ue:flex-col ue:gap-3 ue:p-4">
            <p className="ue:text-footnote ue:text-subtle">
              {t(
                '装在 Plugins/UELink（{mode}），Agent 面板和 UEToVS 共用这一个插件；只在 127.0.0.1 监听，令牌每次启动随机生成；Shipping 包不含它。',
                {
                  mode: project.install?.mode === 'vcs' ? t('已加入版本管理') : t('只在本机'),
                },
              )}
              {upgrade && ` ${t('公共库有 {v}，可以升级。', { v: state?.bundled ?? '' })}`}
              {legacy && ` ${t('现在装的是旧版桥接 AgentPanelBridge，升级会换成 UELink 并删掉旧插件；项目代码依赖了 AgentPanelBridge 模块的，Build.cs 里改成 UELinkCore。')}`}
              {live && ` ${t('编辑器开着：装好、编译完要重启编辑器才加载新版本。')}`}
            </p>
            <div className="ue:flex ue:flex-wrap ue:gap-2">
              {!installed || upgrade ? (
                <>
                  <ui.Button size="sm" disabled={!!busy} onClick={() => void act('install', { mode: 'local' })}>
                    <Download className="ue:h-3.5 ue:w-3.5" /> {upgrade ? t('升级（只在本机）') : t('安装（只在本机）')}
                  </ui.Button>
                  {project.vcs !== 'none' && (
                    <ui.Button
                      size="sm"
                      variant="secondary"
                      disabled={!!busy}
                      onClick={() => void act('install', { mode: 'vcs' })}
                    >
                      {upgrade ? t('升级并加入版本管理') : t('安装并加入版本管理')}
                    </ui.Button>
                  )}
                </>
              ) : null}
              <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void act('build')}>
                <Hammer className="ue:h-3.5 ue:w-3.5" /> {t('编译')}
              </ui.Button>
              {installed && (
                <ui.Button size="sm" variant="danger-outline" disabled={!!busy} onClick={() => void act('uninstall')}>
                  <Trash2 className="ue:h-3.5 ue:w-3.5" /> {t('卸载')}
                </ui.Button>
              )}
            </div>
            {job.data && (
              <div className="ue:flex ue:flex-col ue:gap-1.5">
                <div className="ue:flex ue:items-center ue:gap-2 ue:text-footnote">
                  {job.data.status === 'running' ? <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" /> : null}
                  <span className="ue:text-fg">{job.data.title}</span>
                  {job.data.canceled && job.data.status !== 'running' ? (
                    <Badge>{t('已取消')}</Badge>
                  ) : (
                    <Badge tone={job.data.status === 'done' ? 'ok' : job.data.status === 'failed' ? 'danger' : 'run'}>
                      {job.data.status === 'done' ? t('完成') : job.data.status === 'failed' ? t('失败') : t('进行中')}
                    </Badge>
                  )}
                  {job.data.status === 'running' && job.data.kind === 'build' && !job.data.canceled && (
                    <ui.Button
                      size="sm"
                      variant="ghost"
                      className="ue:ml-auto"
                      disabled={busy === 'cancel'}
                      onClick={() =>
                        void run('cancel', async () => {
                          await post(`/jobs/${job.data!.id}/cancel`)
                          job.reload()
                        })
                      }
                    >
                      <Square className="ue:h-3.5 ue:w-3.5" /> {t('取消编译')}
                    </ui.Button>
                  )}
                </div>
                {job.data.hint && (
                  <BuildHint
                    hint={job.data.hint}
                    busy={!!busy}
                    onBuild={(mode) => void act('build', mode === 'normal' ? undefined : { [mode]: true })}
                  />
                )}
                {/* 换了作业就重新挂载，跟随状态回到「跟到底」 */}
                <Term key={job.data.id} follow className="ue:max-h-72">
                  {job.data.log.slice(-400).map((l, i) => (
                    <div
                      key={i}
                      className={
                        /error|失败/i.test(l) ? 'ue:whitespace-pre-wrap ue:text-danger' : 'ue:whitespace-pre-wrap'
                      }
                    >
                      {l}
                    </div>
                  ))}
                </Term>
              </div>
            )}
          </div>
        </Card>

        <Card title={t('Agent 权限')} aside={t('你在网页上的操作不受限制，危险命令照样确认')}>
          <div className="ue:grid ue:gap-4 ue:p-4 ue:sm:grid-cols-2">
            <ui.Field label={t('运行时')} hint={t('改属性、执行命令和 GM、调函数、清日志')}>
              <ui.Select
                value={form.perms.runtime}
                onChange={(e: { target: { value: string } }) =>
                  void saveSettings({
                    perms: { ...form.perms, runtime: e.target.value as UeProject['perms']['runtime'] },
                  })
                }
                options={[
                  { value: 'write', label: t('可写') },
                  { value: 'ask', label: t('写前问我') },
                  { value: 'read', label: t('只读') },
                ]}
              />
            </ui.Field>
            <ui.Field label={t('资源')} hint={t('改 DataTable、DataAsset、蓝图的默认值、成员和图表')}>
              <ui.Select
                value={form.perms.asset}
                onChange={(e: { target: { value: string } }) =>
                  void saveSettings({ perms: { ...form.perms, asset: e.target.value as UeProject['perms']['asset'] } })
                }
                options={[
                  { value: 'ask', label: t('可改，保存前问我') },
                  { value: 'save', label: t('直接保存') },
                  { value: 'read', label: t('只读') },
                ]}
              />
            </ui.Field>
            <ui.Field label={t('结构性操作')} hint={t('新建、复制、改名和移动资源；删除每次都问你')}>
              <ui.Select
                value={form.perms.struct}
                onChange={(e: { target: { value: string } }) =>
                  void saveSettings({
                    perms: { ...form.perms, struct: e.target.value as UeProject['perms']['struct'] },
                  })
                }
                options={[
                  { value: 'ask', label: t('每次问我') },
                  { value: 'allow', label: t('允许') },
                  { value: 'read', label: t('不允许') },
                ]}
              />
            </ui.Field>
            <ui.Field
              label={t('执行 Python')}
              hint={t('兜底用：在编辑器里跑任意脚本，没有撤回；开了也每次问你，项目要启用 Python 插件')}
            >
              <ui.Select
                value={form.perms.python ? 'on' : 'off'}
                onChange={(e: { target: { value: string } }) =>
                  void saveSettings({ perms: { ...form.perms, python: e.target.value === 'on' } })
                }
                options={[
                  { value: 'off', label: t('不允许') },
                  { value: 'on', label: t('允许，每次问我') },
                ]}
              />
            </ui.Field>
          </div>
        </Card>

        <Card title={t('项目设置')}>
          <form
            className="ue:grid ue:gap-4 ue:p-4 ue:sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              void saveSettings({ gmStore: form.gmStore, engineDir: form.engineDir, buildCmd: form.buildCmd })
            }}
          >
            <ui.Field label={t('GM 预设和宏存在')}>
              <ui.Select
                value={form.gmStore}
                onChange={(e: { target: { value: string } }) =>
                  setForm({ ...form, gmStore: e.target.value as UeProject['gmStore'] })
                }
                options={[
                  { value: 'project', label: t('项目里 .agent-panel/ue/gm.json（团队共用）') },
                  { value: 'local', label: t('只在本机') },
                ]}
              />
            </ui.Field>
            <ui.Field
              label={t('引擎目录')}
              hint={`UE ${project.engine.version} · ${project.engine.dir || t('没找到')}`}
            >
              <ui.Input
                value={form.engineDir}
                placeholder={t('自动查找')}
                onChange={(e: { target: { value: string } }) => setForm({ ...form, engineDir: e.target.value })}
              />
            </ui.Field>
            <ui.Field
              label={t('编译命令')}
              hint={t('留空用引擎的 Build.bat 编 {target}', {
                target: project.cpp ? `${project.uname}Editor` : 'UnrealEditor',
              })}
              className="ue:sm:col-span-2"
            >
              <ui.Input
                value={form.buildCmd}
                placeholder={t('自动')}
                onChange={(e: { target: { value: string } }) => setForm({ ...form, buildCmd: e.target.value })}
              />
            </ui.Field>
            <div className="ue:flex ue:gap-2 ue:sm:col-span-2">
              <ui.Button size="sm" type="submit" disabled={!!busy}>
                {t('保存')}
              </ui.Button>
              <ui.Button
                size="sm"
                variant="ghost"
                className="ue:ml-auto ue:text-danger"
                onClick={() => setRemoving(true)}
              >
                {t('从 UE 页移除这个项目')}
              </ui.Button>
            </div>
          </form>
        </Card>
      </div>
      <Confirm
        open={removing}
        title={t('移除这个项目？')}
        okText={t('移除')}
        danger
        onCancel={() => setRemoving(false)}
        onOk={() =>
          void run('remove', async () => {
            setRemoving(false)
            await ppost(project.id, 'remove', { uninstall: false })
            route.go('main', '')
          })
        }
      >
        {t('只是不再在 UE 页里管理它，项目里装的桥接插件不会删除（要删先点「卸载」）。')}
      </Confirm>
    </div>
  )
}
