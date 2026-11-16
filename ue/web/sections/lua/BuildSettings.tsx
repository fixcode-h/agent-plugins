import { useEffect, useState } from 'react'
import type { LuaBuildConfig } from '../../../server/types.ts'
import { ppost, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Card } from '../../ui.tsx'
import { loadBuild, useLuaBuild } from './build-store.ts'

/**
 * 「权限与设置」里的「Lua 编译」（设计稿四.3）：全编译、增量两条指令，工作目录、脚本目录、报错格式、编完重载、编辑器。
 * 只有装了 UnLua 的项目显示（state.unlua）。保存时服务端会检查报错格式写得对不对
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
      await ppost(project.id, 'lua-build/config', form)
      await loadBuild(project.id)
      toast.success(t('已保存'))
    })

  return (
    <Card title={t('Lua 编译')} aside={t('在本机跑，不经过 UE；Agent 也只能跑这两条')}>
      <form
        className="ue:grid ue:gap-4 ue:p-4 ue:sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <ui.Field
          label={t('全编译指令')}
          hint={t('整行交给命令行执行，例如 tools\\LuaBuild\\build_all.bat')}
          className="ue:sm:col-span-2"
        >
          <ui.Input className="ue:font-mono" placeholder={t('没配')} {...field('full')} />
        </ui.Field>
        <ui.Field
          label={t('增量编译指令')}
          hint={t('{files} 换成改过的文件（相对脚本目录）；文件多时用 {filelist}，换成一个每行一个文件的临时文件')}
          className="ue:sm:col-span-2"
        >
          <ui.Input className="ue:font-mono" placeholder="tools\LuaBuild\build.bat {files}" {...field('incremental')} />
        </ui.Field>
        <ui.Field label={t('工作目录')} hint={t('相对项目根，留空是项目根')}>
          <ui.Input className="ue:font-mono" placeholder={t('<项目>')} {...field('cwd')} />
        </ui.Field>
        <ui.Field label={t('Lua 脚本目录')} hint={t('相对项目根：找改过的文件、文件换成模块名都按它')}>
          <ui.Input className="ue:font-mono" {...field('scriptDir')} />
        </ui.Field>
        <ui.Field
          label={t('报错格式')}
          hint={t('用 {file} {line} {col} {message} 占位；也可以前后加 / 写正则（命名分组 file、line、message）')}
        >
          <ui.Input className="ue:font-mono" {...field('errorFormat')} />
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
        <div className="ue:sm:col-span-2">
          <ui.Button size="sm" type="submit" disabled={!!busy}>
            {t('保存')}
          </ui.Button>
        </div>
      </form>
    </Card>
  )
}
