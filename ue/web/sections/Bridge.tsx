import { useEffect, useState } from 'react'
import type { UeProject } from '../../server/types.ts'
import { pget, ppost, useAction, useLoad } from '../api.ts'
import { STACK } from '@panel/web/src/components/ui/split-pane'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Card, Confirm, PageHead } from '../ui.tsx'
import { LuaBuildSettings } from './lua/BuildSettings.tsx'
import { LuaSettings } from './lua/LuaSettings.tsx'
import { LayoutSettings } from '../inspect/layouts/settings/LayoutSettings.tsx'

/**
 * 权限与设置：Agent 权限；GM 预设、资源页收藏存哪；引擎目录和编译命令；从 UE 页移除项目；资源查看布局。
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
  // gm.json 的实际位置（文档根由面板算，可能在项目外）
  const gmFile = useLoad(() => pget<{ file: string }>(project.id, 'gm/info'), [project.id, project.gmStore])
  useEffect(() => {
    setForm(project)
  }, [project])

  const saveSettings = (patch: Partial<UeProject>) =>
    run('settings', async () => {
      // 先把选的值显示出来，不等项目列表重取回来
      setForm((f) => ({ ...f, ...patch }))
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
            <ui.Field label={t('结构性操作')} hint={t('新建、复制、改名、移动和删除资源')}>
              <ui.Select
                value={form.perms.struct}
                onChange={(e: { target: { value: string } }) =>
                  void saveSettings({
                    perms: { ...form.perms, struct: e.target.value as UeProject['perms']['struct'] },
                  })
                }
                options={[
                  { value: 'allow', label: t('允许，不用问我') },
                  { value: 'ask', label: t('每次问我') },
                  { value: 'read', label: t('不允许') },
                ]}
              />
            </ui.Field>
            <ui.Field
              label={t('执行 Python')}
              hint={t('兜底用：在编辑器里跑任意脚本，没有撤回；项目要启用 Python 插件')}
            >
              <ui.Select
                value={form.perms.python}
                onChange={(e: { target: { value: string } }) =>
                  void saveSettings({
                    perms: { ...form.perms, python: e.target.value as UeProject['perms']['python'] },
                  })
                }
                options={[
                  { value: 'allow', label: t('允许，不用问我') },
                  { value: 'ask', label: t('允许，每次问我') },
                  { value: 'read', label: t('不允许') },
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
            <ui.Field
              label={t('GM 的东西存在')}
              hint={gmFile.data?.file || t('预设、宏、表格关联、对象列表、自定义 GM、模块和收藏')}
            >
              <ui.Select
                value={form.gmStore === 'local' ? 'local' : 'docs'}
                onChange={(e: { target: { value: string } }) =>
                  setForm({ ...form, gmStore: e.target.value as UeProject['gmStore'] })
                }
                options={[
                  { value: 'docs', label: t('项目文档根 AgentPanel/UE/gm.json（团队共用）') },
                  { value: 'local', label: t('只在本机') },
                ]}
              />
            </ui.Field>
            {/* 收藏、Lua 片段、Lua GM 扫描设置、Lua 编译的共用设置都存项目文档根，可以提交给团队共用（用户 2026-11-21 定，不再可选） */}
            <ui.Field
              label={t('资源页收藏、Lua 片段和 GM 扫描设置存在')}
              hint={t('项目文档目录里，可以提交给团队共用')}
            >
              <div className="ue:min-h-8 ue:break-all ue:py-1.5 ue:font-mono ue:text-footnote ue:text-fg">
                {favFile.data?.file ? favFile.data.file.replace(/[\\/][^\\/]+$/, '') : '…'}
              </div>
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
        <LuaSettings />
        <LuaBuildSettings />
        {/* 资源页按资源类型用的布局、各区域的尺寸（本机记的，所有项目共用） */}
        <LayoutSettings />
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
