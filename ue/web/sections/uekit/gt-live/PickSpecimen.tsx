import { useState } from 'react'
import { t } from '../../../host.ts'
import { FieldGroups, itemKey } from '../gt-vars/FieldGroups.tsx'
import type { VarGroup } from '../gt-vars/model.ts'
import { LiveFrame } from './LiveFrame.tsx'
import { NowBadge } from './NowBar.tsx'
import type { StateKey } from './pick-model.ts'
import { PickState } from './PickState.tsx'

const GROUPS: VarGroup[] = [
  {
    src: 'cpp',
    title: 'UGuideWidgetBase',
    class: 'UGuideWidgetBase',
    items: [
      { name: 'CurrentPage', path: 'CurrentPage', type: 'int32', kind: 'prop', value: 2 },
      { name: 'TotalPages', path: 'TotalPages', type: 'int32', kind: 'prop', value: 5 },
    ],
  },
  {
    src: 'bp',
    title: 'WBP_Guide',
    asset: '/Game/UI/Guide/WBP_Guide',
    items: [{ name: 'bCanFinish', path: 'bCanFinish', type: 'bool', kind: 'prop', value: false }],
  },
  {
    src: 'lua',
    title: 'UI/Guide/GuidePanel.lua',
    file: 'UI/Guide/GuidePanel.lua',
    items: [
      { name: 'curPage', path: 'self.curPage', type: 'number', kind: 'prop', value: 3, line: 12 },
      { name: 'isLast', path: 'self.isLast', type: 'boolean', kind: 'prop', value: false, line: 13 },
    ],
  },
]

/**
 * 设置 →「组件」里「从游戏里抓」的示例（效果图 3）：画面占位、控件状态、按 C++ / 蓝图 / Lua 分组的字段，
 * 第二行模拟「刚变了」的闪烁；假数据、不连 UE
 */
export function PickSpecimen() {
  const [state, setState] = useState<StateKey>('enabled')
  const [field, setField] = useState<string>()
  const lit = new Set(['state:text', itemKey(GROUPS[0], GROUPS[0].items[0])])
  return (
    <div className="ue:grid ue:grid-cols-1 ue:gap-3 ue:md:grid-cols-2">
      <div className="ue:flex ue:flex-col ue:gap-2">
        <LiveFrame error={t('示例：不连游戏，没有画面')} onPick={() => undefined} />
        <NowBadge />
      </div>
      <div className="ue:flex ue:h-[360px] ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
        <PickState
          widgetClass="UButton"
          rows={[
            { id: 'visible', label: t('可见'), value: true },
            { id: 'enabled', label: t('能点（启用）'), value: false },
            { id: 'text', label: t('文字'), value: '完成引导' },
          ]}
          selected={state}
          onSelect={(id) => setState(id)}
          lit={lit}
        />
        <FieldGroups
          groups={GROUPS}
          showValue
          lit={lit}
          selected={new Set(field ? [field] : [])}
          onToggle={(g, it) => setField(itemKey(g, it))}
        />
      </div>
    </div>
  )
}
