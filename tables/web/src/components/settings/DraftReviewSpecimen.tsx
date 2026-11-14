import { resolveTablesProposal } from '@shared/tables-assist'
import { toast } from '@/lib/toast'
import { DraftReview } from '@/components/tables/TablesDraftReview'

/** 样例：一次 AI 分析表格风格的结果（演示数据不翻译） */
const SAMPLE = resolveTablesProposal({
  summary: '5 行表头，主键 ID，数组用分号隔开',
  style: {
    header: {
      start: 0,
      rows: [
        { kind: 'modifier', label: '修饰', values: 'Modifier' },
        { kind: 'type', label: '类型', values: '@types' },
        { kind: 'name', label: '字段名' },
        { kind: 'comment', label: '注释' },
      ],
    },
    key: 'ID',
    listSep: ';',
  },
  enums: { Quality: { values: [{ name: 'White' }, { name: 'Green' }, { name: 'Blue' }] } },
  types: { FVector: { kind: 'struct', fields: [{ name: 'X', type: 'float' }], store: '{X}' } },
  columns: { 'Item/Item.xlsx#*#DropID': { ref: 'Drop/Drop.xlsx#ID' } },
}).proposal!.draft

/**
 * 设置 → 组件里的 AI 分析结果勾选列表：项目设置「表格」页底下、AI 分析窗口右侧功能面板用的同一个，
 * 外观跟着「按钮」的微调走。点应用只弹提示，不写任何项目
 */
export function DraftReviewSpecimen() {
  return (
    <DraftReview
      draft={SAMPLE}
      onCancel={() => toast.success('不要了')}
      onApply={async (picked) => {
        toast.success(`应用 ${picked.size} 项`)
      }}
    />
  )
}
