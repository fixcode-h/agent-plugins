import { t } from '../../host.ts'
import type { LeakItem, ProfItem, SnapCapture } from './debug-types.ts'
import { CaptureView, LeakList, ProfileTable } from './DebugViews.tsx'

/** 设置 →「组件」里 Lua「调试」页签三块结果的示例（示例数据，不连 UE） */
const ROOT = 'D:/Proj/MyGame'

const PROF: ProfItem[] = [
  {
    fn: 'Tick',
    src: '...Script/UI/BagPanel.lua:88',
    file: `${ROOT}/Content/Script/UI/BagPanel.lua`,
    line: 88,
    c: false,
    calls: 1240,
    totalMs: 412.6,
    selfMs: 96.3,
  },
  {
    fn: 'RefreshSlots',
    src: '...Script/UI/BagPanel.lua:140',
    file: `${ROOT}/Content/Script/UI/BagPanel.lua`,
    line: 140,
    c: false,
    calls: 310,
    totalMs: 290.1,
    selfMs: 61.8,
  },
  {
    fn: 'GetItemConfig',
    src: '...Script/Data/ItemData.lua:12',
    file: `${ROOT}/Content/Script/Data/ItemData.lua`,
    line: 12,
    c: false,
    calls: 18600,
    totalMs: 120.4,
    selfMs: 58.2,
  },
  { fn: 'SetText', src: '[C]', line: 0, c: true, calls: 9300, totalMs: 44.7, selfMs: 44.7 },
]

const CAP: SnapCapture = {
  at: new Date().toISOString(),
  fn: 'RefreshSlots',
  src: '...Script/UI/BagPanel.lua:152',
  file: `${ROOT}/Content/Script/UI/BagPanel.lua`,
  line: 152,
  locals: [
    {
      name: 'self',
      t: 'table',
      n: 14,
      module: 'UI.BagPanel',
      fields: [
        { k: 'PageIndex', v: 2 },
        { k: 'bLocked', v: false },
      ],
    },
    { name: 'slotIndex', t: 'number', v: 7, int: true },
    { name: 'itemId', t: 'number', v: 1003, int: true },
    { name: 'item', t: 'nil' },
  ],
  upvalues: [{ name: 'MAX_SLOTS', t: 'number', v: 40, int: true }],
  stack: ["...Script/UI/BagPanel.lua:152: in method 'RefreshSlots'", "...Script/UI/BagPanel.lua:96: in method 'Tick'"],
}

const LEAKS: LeakItem[] = [
  { kind: 'destroyed', module: 'UI.ShopPanel', path: '_G.UIManager.OpenedPanels[3]' },
  {
    kind: 'noworld',
    module: 'Gameplay.Buff',
    object: '/Game/Maps/Test.Test:PersistentLevel.BP_Hero_C_0',
    class: 'BP_Hero_C',
    path: 'BuffSystem<upvalue Owners>[12]',
  },
]

const noop = () => undefined

export function LuaDebugSpecimen() {
  return (
    <div className="ue:flex ue:flex-col ue:gap-6">
      <div>
        <div className="ue:mb-2 ue:text-caption ue:text-subtle">{t('性能采样')}</div>
        <ProfileTable items={PROF} onOpen={noop} />
      </div>
      <div>
        <div className="ue:mb-2 ue:text-caption ue:text-subtle">{t('快照点')}</div>
        <CaptureView cap={CAP} onOpen={noop} />
      </div>
      <div>
        <div className="ue:mb-2 ue:text-caption ue:text-subtle">{t('Lua 持有的已销毁对象')}</div>
        <LeakList items={LEAKS} />
      </div>
    </div>
  )
}
