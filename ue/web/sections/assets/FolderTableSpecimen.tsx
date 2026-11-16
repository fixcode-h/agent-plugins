import { useState } from 'react'
import { t } from '../../host.ts'
import type { StatItem } from './folder-contents.ts'
import { FOLDER_ROW, FolderTable } from './FolderTable.tsx'

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()

/** 示例数据：各种状态都摆一行（未保存 + 自己签出、别人签出、未被引用、还没存过盘） */
const ITEMS: StatItem[] = [
  {
    name: 'WBP_Bag',
    path: '/Game/UI/Bag/WBP_Bag.WBP_Bag',
    class: 'WidgetBlueprint',
    size: 421888,
    mtime: ago(1),
    dirty: true,
    vcs: { action: 'edit' },
    refs: 3,
  },
  {
    name: 'WBP_BagSlot',
    path: '/Game/UI/Bag/WBP_BagSlot.WBP_BagSlot',
    class: 'WidgetBlueprint',
    size: 190464,
    mtime: ago(3),
    vcs: { others: ['lee@lee-ws'] },
    refs: 1,
  },
  {
    name: 'DT_BagSlot',
    path: '/Game/UI/Bag/DT_BagSlot.DT_BagSlot',
    class: 'DataTable',
    size: 24576,
    mtime: ago(30),
    dirty: true,
    refs: 2,
  },
  {
    name: 'T_Bag_Bg',
    path: '/Game/UI/Bag/T_Bag_Bg.T_Bag_Bg',
    class: 'Texture2D',
    size: 2202009,
    mtime: ago(300),
    refs: 0,
  },
  {
    name: 'T_Bag_Slot_Normal',
    path: '/Game/UI/Bag/T_Bag_Slot_Normal.T_Bag_Slot_Normal',
    class: 'Texture2D',
    size: 262144,
    mtime: ago(320),
    refs: 4,
  },
  {
    name: 'MI_Bag_Glow',
    path: '/Game/UI/Bag/MI_Bag_Glow.MI_Bag_Glow',
    class: 'MaterialInstanceConstant',
    size: 12288,
    mtime: ago(500),
    refs: 1,
  },
  {
    name: 'DA_BagNew',
    path: '/Game/UI/Bag/DA_BagNew.DA_BagNew',
    class: 'PrimaryDataAsset',
    dirty: true,
    vcs: { action: 'add' },
  },
]

/**
 * 设置 →「组件」里的「资源 · 文件夹内容表」：资源页选中文件夹时右栏的表（类型胶囊、状态列、底栏合计），能调行高
 */
export function FolderTableSpecimen() {
  const [row, setRow] = useState(FOLDER_ROW)
  const [sel, setSel] = useState<string>()
  return (
    <div className="ue:flex ue:w-full ue:flex-col ue:gap-3">
      <label className="ue:flex ue:items-center ue:gap-2 ue:text-footnote ue:text-subtle">
        {t('行高')}
        <input
          type="range"
          min={26}
          max={40}
          value={row}
          onChange={(e) => setRow(Number(e.target.value))}
          className="ue:accent-accent"
        />
        {row}px
      </label>
      <div className="ue:flex ue:h-96 ue:overflow-hidden ue:border ue:border-line ue:bg-card">
        <FolderTable
          folders={[{ name: 'Icons', path: '/Game/UI/Bag/Icons', count: 12 }]}
          items={ITEMS}
          selected={sel}
          onSelect={setSel}
          onOpen={setSel}
          onOpenFolder={() => undefined}
          editor
          rowHeight={row}
        />
      </div>
    </div>
  )
}
