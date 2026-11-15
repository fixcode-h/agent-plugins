import { Download, Hammer, Loader2, Square, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Job } from '../../../server/types.ts'
import { canUpgrade } from '../../../server/semver.ts'
import { get, post, ppost, useAction, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge, Card, Term } from '../../ui.tsx'
import { BuildHint } from '../BuildHint.tsx'

/**
 * UE 插件页最上面的 UELink（UEKit 的基础插件，扩展都挂在它上面）：安装、升级、编译、卸载和输出。
 * 原来在「桥接与权限」页，用户要和 AssetForge、GameTest 放在一起装（2026-11-15）。
 * needPre：扩展要的 UELink 只有预发布版时，给一个「升级到预发布」按钮（只在这里用预发布，查更新仍只认正式版）
 */
export function UELinkCard({ needPre, onChanged }: { needPre?: string; onChanged?: () => void }) {
  const { project, state, reload } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const [jobId, setJobId] = useState('')
  const latest = jobId || state?.jobs.at(-1)?.id || ''
  const job = useLoad(() => (latest ? get<Job>(`/jobs/${latest}`) : Promise.resolve(undefined)), [latest], 1500)
  const installed = state?.bridge
  const upgrade = canUpgrade(installed, state?.bundled)
  // 旧版桥接（AgentPanelBridge 1.x）：升级时会换成 UELink 并删掉旧插件
  const legacy = !!installed && canUpgrade(installed, '2.0.0')
  const live = (state?.instances ?? []).some((i) => i.kind === 'editor')
  const mode = project.install?.mode === 'vcs' ? 'vcs' : 'local'
  const act = (what: 'install' | 'uninstall' | 'build', body?: unknown) =>
    run(what, async () => {
      const r = await ppost<{ job: string; build?: string }>(project.id, what, body)
      setJobId(r.build ?? r.job)
      reload()
      onChanged?.()
    })

  return (
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
          {upgrade && ` ${t('UEKit 里有 {v}，可以升级。', { v: state?.bundled ?? '' })}`}
          {needPre &&
            ` ${t('下面的扩展要 UELink {v}，它还是预发布版（C++ 没经本地编译验证），升级后要完整编译一次。', { v: needPre })}`}
          {legacy &&
            ` ${t('现在装的是旧版桥接 AgentPanelBridge，升级会换成 UELink 并删掉旧插件；项目代码依赖了 AgentPanelBridge 模块的，Build.cs 里改成 UELinkCore。')}`}
          {live && ` ${t('编辑器开着：装好、编译完要重启编辑器才加载新版本。')}`}
        </p>
        <div className="ue:flex ue:flex-wrap ue:gap-2">
          {needPre && (
            <ui.Button size="sm" disabled={!!busy} onClick={() => void act('install', { mode, prerelease: needPre })}>
              <Download className="ue:h-3.5 ue:w-3.5" /> {t('升级到 {v}（预发布）', { v: needPre })}
            </ui.Button>
          )}
          {!needPre && (!installed || upgrade) ? (
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
                  className={/error|失败/i.test(l) ? 'ue:whitespace-pre-wrap ue:text-danger' : 'ue:whitespace-pre-wrap'}
                >
                  {l}
                </div>
              ))}
            </Term>
          </div>
        )}
      </div>
    </Card>
  )
}
