import { t } from '../../host.ts'
import type { SnapCapture } from './debug-types.ts'
import { CaptureView } from './DebugViews.tsx'

/** 设置 →「组件」里 Lua「调试」页签快照记录的示例（示例数据，不连 UE） */
const ROOT = 'D:/Proj/MyGame'

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

const noop = () => undefined

export function LuaDebugSpecimen() {
  return (
    <div className="ue:flex ue:flex-col ue:gap-6">
      <div>
        <div className="ue:mb-2 ue:text-caption ue:text-subtle">{t('快照点')}</div>
        <CaptureView cap={CAP} onOpen={noop} />
      </div>
    </div>
  )
}
