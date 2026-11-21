import { Blocks } from 'lucide-react'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'

/** 扩展页在项目没装这个扩展时：说明一下，给个去「UE 插件」页安装的按钮 */
/** desc：换掉默认那句说明（GM 页借它提示「对象调用要 GameTest」，GameTest 不限 5.8） */
export function NotInstalled({ name, desc }: { name: string; desc?: string }) {
  const { go } = useUe()
  const { ui } = h()
  return (
    <div className="ue:flex ue:flex-1 ue:items-center ue:justify-center ue:p-8">
      <div className="ue:flex ue:max-w-md ue:flex-col ue:items-center ue:gap-3 ue:text-center">
        <span className="ue:flex ue:h-11 ue:w-11 ue:items-center ue:justify-center ue:rounded-xl ue:bg-hover ue:text-fg">
          <Blocks className="ue:h-5 ue:w-5" />
        </span>
        <h1 className="ue:text-subtitle ue:font-medium ue:text-fg">{t('项目里还没装 {name}', { name })}</h1>
        <p className="ue:text-body ue:leading-relaxed ue:text-muted">
          {desc ??
            t('{name} 是 UEKit 里 UELink 的扩展插件，只支持 UE 5.8。装好后要完整编译一次、重启编辑器。', { name })}
        </p>
        <ui.Button onClick={() => go('plugins')}>{t('去「UE 插件」安装')}</ui.Button>
      </div>
    </div>
  )
}
