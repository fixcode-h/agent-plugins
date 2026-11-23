import { TreeList, type TreeLine } from '@panel/web/src/components/ui/tree/tree-list'
import { Box, Braces } from 'lucide-react'
import { t } from '../../../host.ts'
import { LeakView } from './LeakView.tsx'
import { ChainChips, ObjectHead } from './ObjectHead.tsx'
import { StateBadge, StateDot, StateLegend } from './parts.tsx'

/** 设置 →「组件」里 Lua 对象页的示例（示例数据，不连 UE）：树的几行、对象卡、继承链、状态、已销毁对象 */
const noop = () => undefined

const row = (key: string, depth: number, label: string, mono = true): TreeLine => ({
  key,
  depth,
  icon: depth === 0 ? Braces : Box,
  iconTone: depth === 0 ? 'ue:text-accent-text' : undefined,
  label: (
    <span className={mono ? 'ue:flex ue:items-center ue:gap-1.5 ue:font-mono' : undefined}>
      {depth > 0 && <StateDot state={key === 'b' ? 'garbage' : 'alive'} />}
      {label}
    </span>
  ),
  aside: depth === 0 ? 2 : key === 'b' ? <StateBadge state="garbage" /> : undefined,
  expandable: depth === 0,
  open: true,
  selected: key === 'a',
})

export function LuaObjectsSpecimen() {
  return (
    <div className="ue:flex ue:flex-col ue:gap-6">
      <div>
        <div className="ue:mb-2 ue:text-caption ue:text-subtle">{t('Lua 对象')}</div>
        <div className="ue:flex ue:h-[150px] ue:w-80 ue:flex-col ue:border ue:border-line">
          <TreeList
            label={t('Lua 对象')}
            lines={[
              row('m', 0, 'AI.BP_AICharacter_C'),
              row('a', 1, 'BP_AICharacter_C_0'),
              row('b', 1, 'BP_AICharacter_C_1'),
            ]}
          />
          <StateLegend />
        </div>
      </div>
      <ObjectHead
        name="BP_PlayerController_C_0"
        path="/Game/Maps/Main.Main:PersistentLevel.BP_PlayerController_C_0"
        obj={{
          path: '/Game/Maps/Main.Main:PersistentLevel.BP_PlayerController_C_0',
          name: 'BP_PlayerController_C_0',
          class: 'BP_PlayerController_C',
          module: 'Player.BP_PlayerController_C',
          world: 'pie0',
        }}
        src='[string "D:/Proj/MyGame/Content/Script/Player/BP_PlayerController_C.lua"]:18'
        onOpenObj={noop}
        onOpenLua={noop}
        onWatch={noop}
      />
      <ChainChips
        top={t('实例表')}
        chain={[
          { name: 'Player.BP_PlayerController_C', kind: 'lua' },
          { name: 'BP_PlayerController_C', kind: 'ue' },
          { name: 'APlayerController', kind: 'ue' },
          { name: '' },
        ]}
        onModule={noop}
      />
      <div className="ue:border ue:border-line">
        <LeakView
          item={{ kind: 'destroyed', module: 'UI.WBP_ShopPanel_C', path: '_G.UIManager.Panels[3]' }}
          onGcAndScan={noop}
        />
      </div>
    </div>
  )
}
