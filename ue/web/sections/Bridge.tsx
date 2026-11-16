import { useEffect, useState } from 'react'
import type { UeProject } from '../../server/types.ts'
import { pget, ppost, useAction, useLoad } from '../api.ts'
import { STACK } from '../split.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Card, Confirm, PageHead } from '../ui.tsx'
import { LuaBuildSettings } from './lua/BuildSettings.tsx'

/**
 * 权限与设置：Agent 权限；GM 预设、资源页收藏存哪；引擎目录和编译命令；从 UE 页移除项目。
 * UELink 的安装、升级、编译挪到了「UE 插件」页（uekit/Plugins.tsx），和 UEKit 的扩展放在一起
 */
export function Bridge() {
  const { project, state, reload } = useUe()
  const { ui, toast, hooks } = h()
  const route = hooks.usePluginRoute()
  const { busy, run } = useAction()
  const [form, setForm] = useState(project)
  const [removing, setRemoving] = useState(false)
  // 收藏文件的实际位置（文档根可能在项目外层的 ProjectDoc/docs），写在设置项下面
  const favFile = useLoad(() => pget<{ file: string }>(project.id, 'favorites'), [project.id])
  useEffect(() => {
    setForm(project)
  }, [project])

  const saveSettings = (patch: Partial<UeProject>) =>
    run('settings', async () => {
      await ppost(project.id, 'settings', patch)
      toast.success(t('已保存'))
      reload()
    })
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('权限与设置')} desc={project.root} />
      <div className={STACK}>
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
              label={t('资源页收藏的文件夹存在')}
              hint={favFile.data?.file || t('都在项目里，可以提交给团队共用；换位置时现有的收藏会一起带过去')}
            >
              <ui.Select
                value={form.favStore}
                onChange={(e: { target: { value: string } }) =>
                  void saveSettings({ favStore: e.target.value as UeProject['favStore'] }).then(() => favFile.reload())
                }
                options={[
                  { value: 'docs', label: t('项目文档目录 docs/AgentPanel/UE') },
                  { value: 'project', label: t('项目里 .agent-panel/ue') },
                ]}
              />
            </ui.Field>
            <ui.Field
              label={t('引擎目录')}
              hint={`UE ${project.engine.version} · ${project.engine.dir || t('没找到')}`}
              className="ue:sm:col-span-2"
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
        <LuaBuildSettings />
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
