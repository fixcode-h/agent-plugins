import { EnumScan, type ScanRun } from '@shared/table-enum-scan'
import { EnumScanRow } from '@/components/projects/ProjectTablesScans'
import { ScanPreview } from '@/components/tables/EnumScanParts'

/** 样例规则和一次扫描结果（演示数据不翻译） */
const RULE = EnumScan.parse({
  id: 'demo',
  name: 'EnumType',
  from: { kind: 'block', file: 'Config/Enum.xlsx', sheet: 'EnumType', enumCol: 'A', nameCol: 'B', valueCol: 'C' },
})
const RUN: ScanRun = {
  id: 'demo',
  at: '2026-11-14T02:00:00.000Z',
  enums: {
    OutsideAttributeDisplayEntry: [
      { name: 'CharacterTotal', value: '1' },
      { name: 'CharacterLevel', value: '2' },
      { name: 'CharacterTalent', value: '3' },
      { name: 'CharacterMotive', value: '4' },
    ],
    ItemQuality: [
      { name: 'White', value: '0' },
      { name: 'Blue', value: '1' },
    ],
  },
  warnings: ['ItemQuality 的成员 Blue 重复了（第 8 行），只留第一个'],
  diff: { added: ['ItemQuality'], removed: [], changed: [] },
}

/**
 * 设置 → 组件里的枚举扫描：项目设置 → 表格 → 枚举的规则行、规则弹窗里的试跑结果用的同一套，
 * 外观跟着「按钮」「输入框」的微调走
 */
export function EnumScanSpecimen() {
  return (
    <div className="tb:grid tb:gap-4 tb:lg:grid-cols-2">
      <div className="tb:overflow-hidden tb:rounded-(--c-card-radius) tb:border tb:self-start">
        <EnumScanRow
          rule={RULE}
          state={{ at: new Date(Date.now() - 180_000).toISOString(), warnings: [], enums: 42 }}
          onScan={() => {}}
          onEdit={() => {}}
          onRemove={() => {}}
        />
      </div>
      <ScanPreview run={RUN} />
    </div>
  )
}
