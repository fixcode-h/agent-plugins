import { useEffect, useState } from 'react'
import type { LuaBuildConfig } from '../../../server/types.ts'
import { ppost, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Card } from '../../ui.tsx'
import { loadBuild, useLuaBuild } from './build-store.ts'
import { BuildToolPick } from './BuildTools.tsx'

/**
 * 「权限与设置」里的「Lua 编译」（设计稿四.3）：两个按钮各用哪个项目工具（和编译页左边同一个组件，选了马上存），
 * 下面是脚本目录、编完重载、编辑器。只有装了 UnLua 的项目显示（state.unlua）
 */
export function LuaBuildSettings() {
  const { project, state } = useUe()
  const b = useLuaBuild(project.id)
  const { busy, run } = useAction()
  const { ui, toast } = h()
  const [form, setForm] = useState<LuaBuildConfig | undefined>(b.snap?.config)
  const saved = b.snap?.config
  useEffect(() => {
    if (saved) setForm(saved)
  }, [saved])
  if (!state?.unlua || !form) return null

  const field = (k: keyof LuaBuildConfig) => ({
    value: String(form[k] ?? ''),
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }),
  })
  const save = () =>
    run('lua-build', async () => {
      // 工具在上面选了就存了，这里只存下面这几项，免得拿表单里的旧值盖掉刚选的工具
      const { scriptDir, autoReload, editor } = form
      await ppost(project.id, 'lua-build/config', { scriptDir, autoReload, editor })
      await loadBuild(project.id)
      toast.success(t('已保存'))
    })

  return (
    <Card title={t('Lua 编译')} aside={t('在本机跑项目工具，不经过 UE；Agent 也只能跑选好的这两个')}>
      <div className="ue:border-b ue:border-line ue:p-4">
        <BuildToolPick />
      </div>
      <form
        className="ue:grid ue:gap-4 ue:p-4 ue:sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <ui.Field label={t('Lua 脚本目录')} hint={t('相对项目根：找改过的文件、文件换成模块名都按它')}>
          <ui.Input className="ue:font-mono" {...field('scriptDir')} />
        </ui.Field>
        <ui.Field label={t('编完')}>
          <ui.Select
            value={form.autoReload ? 'on' : 'off'}
            onChange={(e: { target: { value: string } }) => setForm({ ...form, autoReload: e.target.value === 'on' })}
            options={[
              { value: 'on', label: t('成功后自动重载改过的模块') },
              { value: 'off', label: t('不重载') },
            ]}
          />
        </ui.Field>
        <ui.Field
          label={t('打开报错用的编辑器')}
          hint={t('{file} {line} 占位，例如 code -g "{file}:{line}"；留空用系统默认程序打开（不跳到行）')}
          className="ue:sm:col-span-2"
        >
          <ui.Input className="ue:font-mono" placeholder={t('系统默认')} {...field('editor')} />
        </ui.Field>
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-3 ue:sm:col-span-2">
          <ui.Button size="sm" type="submit" disabled={!!busy}>
            {t('保存')}
          </ui.Button>
          {b.snap?.sharedFile && (
            <span className="ue:min-w-0 ue:break-all ue:text-caption ue:text-subtle">
              {t('选的工具和脚本目录存在 {f}，团队共用；编完重载和编辑器只存本机', { f: b.snap.sharedFile })}
            </span>
          )}
        </div>
      </form>
    </Card>
  )
}
