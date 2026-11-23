import { t } from '../../host.ts'
import type { ForgeEntry } from './Forge.tsx'
import { forgeReportRows, JobReportView } from './ForgeJobReport.tsx'
import { ForgeLink } from './ForgeLink.tsx'
import { STATES } from './kinds.ts'
import { StatePill } from './StatePill.tsx'

/**
 * 设置 →「组件」里 AssetForge 共用部件的示例（设计稿 §4）：StatePill 各状态、ForgeLink 三种方向、一份小作业报告。
 * 全是假数据，不连 UE（设置页里没有 UE 页的上下文）。右键菜单借面板「ItemMenu」示例挂的 MenuHost，
 * 这里不再挂一个（一页挂两个会弹出两份菜单）。
 */
const ENTRIES: ForgeEntry[] = [
  { key: 'a', name: 'WBP_Shop', state: 'asset-missing', config: 'umg/UI/Menus/WBP_Shop.json' },
  { key: 'b', name: 'WBP_MainMenu', state: 'synced', config: 'umg/UI/Menus/WBP_MainMenu.json' },
  { key: 'c', name: 'DT_Levels', state: 'synced', config: 'data/DT_Levels.json' },
]

const REPORTS = [
  {
    sourcePath: 'D:/Proj/docs/AssetForge/umg/UI/Menus/WBP_Shop.json',
    assetPath: '/Game/UI/Menus/WBP_Shop',
    succeeded: false,
    diagnostics: [{ severity: 'error', message: '父类 /Game/UI/WBP_ShopBase 不存在：先导入父类的配置' }],
  },
  {
    sourcePath: 'D:/Proj/docs/AssetForge/umg/UI/Menus/WBP_MainMenu.json',
    succeeded: true,
    updated: 6,
  },
  { sourcePath: 'D:/Proj/docs/AssetForge/data/DT_Levels.json', succeeded: true },
]

export function ForgeSpecimen() {
  const noop = () => undefined
  return (
    <div className="ue:flex ue:w-full ue:flex-col ue:gap-5">
      <div className="ue:flex ue:flex-wrap ue:gap-3">
        {Object.keys(STATES).map((s) => (
          <StatePill key={s} state={s} />
        ))}
        <StatePill state="config-changed" count={2} soft />
      </div>
      <div className="ue:flex ue:flex-col ue:gap-2 ue:rounded-lg ue:border ue:border-line ue:p-3">
        <ForgeLink
          config="umg/UI/Menus/WBP_MainMenu.json"
          asset="/Game/UI/Menus/WBP_MainMenu"
          kind="umg-widget"
          state="config-changed"
          importedAt={new Date().toISOString()}
          onOpenAsset={noop}
        />
        <ForgeLink
          config="bp/Characters/BP_Hero.json"
          asset="/Game/Characters/BP_Hero"
          kind="actor-blueprint"
          state="asset-changed"
          onOpenAsset={noop}
        />
        <ForgeLink
          config="umg/UI/Menus/WBP_Credits.json"
          asset="/Game/UI/Menus/WBP_Credits"
          kind="umg-widget"
          state="never-imported"
        />
      </div>
      <div className="ue:flex ue:h-72 ue:flex-col ue:overflow-hidden ue:rounded-lg ue:border ue:border-line">
        <JobReportView
          job={{
            id: 'demo',
            title: t('导入 3 份配置'),
            mode: 'import',
            status: 'failed',
            total: 3,
            finished: 3,
            succeeded: 2,
            failed: 1,
            round: 2,
            startedAt: new Date(Date.now() - 4800).toISOString(),
            endedAt: new Date().toISOString(),
          }}
          rows={forgeReportRows(REPORTS, ENTRIES)}
          onOpen={noop}
          onRetry={noop}
          onClose={noop}
        />
      </div>
    </div>
  )
}
