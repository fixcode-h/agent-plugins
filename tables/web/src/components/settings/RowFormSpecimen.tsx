import { useState } from 'react'
import type { CellSet } from '@shared/table-edit'
import type { ColInfo } from '@shared/table-struct'
import { RowForm, type RowFormField } from '@/components/tables/RowForm'
import { colHeadOf } from '@/components/tables/col-head'

/** 样例数据：演示数据不翻译 */
const INFOS = [
  { col: 0, field: 'ID', type: 'uint32', required: true },
  { col: 1, field: 'Name', type: 'string' },
  { col: 2, field: 'MountType', enumName: 'HomeDecorationMountType' },
  { col: 3, field: 'Price', type: 'uint32', min: 0, max: 9999 },
] as ColInfo[]
const NOTES = ['编号', '名字', '摆放方式', '价格（金币）']
const FIELDS: RowFormField[] = INFOS.map((info, c) => ({
  col: c,
  info,
  head: colHeadOf(info),
  note: NOTES[c],
  options:
    c === 2
      ? [
          { name: 'FloorMirror', value: '1', desc: '落地' },
          { name: 'WallMirror', value: '2', desc: '挂墙' },
        ]
      : undefined,
}))

/**
 * 设置 → 组件里的「一行的表单」：表格页右边的抽屉，竖着看、改一行。
 * 输入框、下拉建议跟着「输入框」「弹出菜单」的微调走
 */
export function RowFormSpecimen() {
  const [rows, setRows] = useState<string[][]>([
    ['1001', '落地镜', 'FloorMirror', '120'],
    ['1002', '挂墙镜', 'WallMirror', '12000'],
  ])
  const [row, setRow] = useState(0)
  const commit = (cells: CellSet[]) =>
    setRows((rs) => rs.map((r, i) => r.map((v, c) => cells.find((x) => x.r === i && x.c === c)?.v ?? v)))
  return (
    <div className="tb:flex tb:h-[420px] tb:w-full tb:justify-end tb:overflow-hidden tb:rounded-lg tb:border">
      <RowForm
        row={row}
        rows={rows}
        from={0}
        order={[0, 1]}
        fields={FIELDS}
        focusCol={undefined}
        hidden={new Set()}
        problemAt={new Map([['1:3', '不能大于 9999']])}
        dirty={new Set()}
        readOnly={false}
        keyCol={0}
        onCommit={commit}
        onGo={(r) => setRow(r)}
        onRefJump={() => {}}
        onClose={() => {}}
      />
    </div>
  )
}
