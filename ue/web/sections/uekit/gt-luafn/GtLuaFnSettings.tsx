import { Library } from 'lucide-react'
import { useState } from 'react'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { SettingGroup, SettingRow } from '../../../SettingRows.tsx'
import { LuaLibDialog } from './LuaLibDialog.tsx'
import { useLuaFns } from './use-luafn.ts'

/**
 * 插件设置「编写 · 这个项目」的 Lua 函数库（取代 2.9.0 前的「接口库」文件夹设置）：显示存在哪、有几个函数，点开编辑。
 * 编辑页的脚本函数节点、Lua 代码节点里也能打开同一个弹窗
 */
export function GtLuaFnSettings() {
  const { ui } = h()
  const { project } = useUe()
  const lib = useLuaFns(project.id)
  const [open, setOpen] = useState(false)
  return (
    <SettingGroup
      page="luafn"
      title={t('Lua 函数库')}
      aside={t('这个项目')}
      hint={t(
        '测试里要自己写的 Lua 放这里（一组普通函数，没有类结构），或直接写在 Lua 代码节点里；都存在 JSON 里，不会往游戏项目里加 .lua 文件。能用执行 GM、对象调用的先用它们。',
      )}
    >
      <SettingRow title={t('存在')} desc={lib.data?.file ?? t('读取中…')} />
      <SettingRow
        title={t('函数')}
        desc={lib.error || t('{n} 个，按「库.名字」分组', { n: lib.data?.fns.length ?? 0 })}
      >
        <ui.Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Library className="ue:h-3.5 ue:w-3.5" />
          {t('打开函数库…')}
        </ui.Button>
      </SettingRow>
      {open && <LuaLibDialog project={project.id} onClose={() => setOpen(false)} />}
    </SettingGroup>
  )
}
