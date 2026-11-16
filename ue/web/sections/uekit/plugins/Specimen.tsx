import { Download, FileCode2, Link } from 'lucide-react'
import { h, t } from '../../../host.ts'
import { PluginCard } from './PluginCard.tsx'
import type { PluginView } from './model.ts'

/** 设置 →「组件」里 UE 插件页卡片的示例：一张可升级的基础插件、一张没装的扩展 */
export function PluginCardSpecimen() {
  const { ui } = h()
  const info = (tested: string[], tools: string[]) => ({
    engineMin: '5.4',
    engineTested: tested,
    requires: {},
    optional: [{ name: 'UnLua', on: true }],
    tools,
  })
  const link: PluginView = {
    name: 'UELink',
    displayName: 'UELink',
    description: t('让面板连上 UE 进程：控制台、GM、对象属性、资源和蓝图读写、日志、性能、Lua。'),
    base: true,
    known: false,
    installed: { version: '2.4.0-beta.3', rel: 'Plugins/UELink', mode: 'local' },
    offer: { version: '2.4.0-beta.4', prerelease: true, blockers: [] },
    upgrade: true,
    loaded: '2.4.0-beta.3',
    info: info(['5.4', '5.5', '5.6', '5.7', '5.8'], ['ue_status', 'ue_console', 'ue_gm', 'ue_get']),
    requiredBy: ['AssetForge'],
  }
  const forge: PluginView = {
    name: 'AssetForge',
    displayName: 'AssetForge',
    description: t('用 JSON 配置管理资产：导入、导出、演练、同步状态、属性差异。'),
    base: false,
    known: true,
    offer: { version: '1.2.0-beta.3', prerelease: true, blockers: [] },
    upgrade: false,
    info: { ...info(['5.4', '5.8'], ['ue_forge']), requires: { UELink: '>=2.4.0-beta.4' }, optional: [] },
    requiredBy: [],
    withUELink: true,
  }
  return (
    <div className="ue:grid ue:max-w-3xl ue:gap-px ue:overflow-hidden ue:rounded-lg ue:border ue:border-line ue:bg-line ue:sm:grid-cols-2">
      <PluginCard
        view={link}
        icon={Link}
        state={{ tone: 'warn', key: 'upgrade' }}
        engine="5.4.1"
        linkVersion="2.4.0-beta.3"
        footer={<ui.Button size="sm">{t('升级到 {v}', { v: '2.4.0-beta.4' })}</ui.Button>}
        onMore={() => {}}
      />
      <PluginCard
        view={forge}
        icon={FileCode2}
        state={{ tone: 'muted', key: 'missing' }}
        engine="5.4.1"
        linkVersion="2.4.0-beta.3"
        footer={
          <ui.Button size="sm">
            <Download className="ue:h-3.5 ue:w-3.5" /> {t('安装')}
          </ui.Button>
        }
      />
    </div>
  )
}
