import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { PageHead } from '../../ui.tsx'
import { IniBrowser } from './IniBrowser.tsx'
import { TagTree } from './TagTree.tsx'

/**
 * 配置页（设计稿「UE 插件优化与扩展」二 P2，放在控制台旁边）：项目 ini 的分层浏览和 GameplayTag 树，都只读。
 * UE 没开也能看（读磁盘上的 ini）；开着时带上进程里的最终值和 C++ 登记的 Tag。地址 config/<ini|tags>
 */
const TABS = [
  { id: 'ini', label: () => t('项目配置'), View: IniBrowser },
  { id: 'tags', label: () => 'GameplayTag', View: TagTree },
]

export function ConfigPage() {
  const { sub, go } = useUe()
  const { ui } = h()
  const tab = TABS.find((x) => x.id === sub.split('/')[0]) ?? TABS[0]
  const View = tab.View
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead
        title={t('配置')}
        desc={t('每一层 ini 各写了什么、最后哪层生效；GameplayTag 和引用它的资源。只读')}
      >
        <ui.Segmented
          size="sm"
          label={t('配置页签')}
          value={tab.id}
          onChange={(id: string) => go('config', id)}
          options={TABS.map((x) => ({ id: x.id, label: x.label() }))}
        />
      </PageHead>
      <View />
    </div>
  )
}
