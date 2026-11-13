import { useMemo, useState } from 'react'
import { TableSchema } from '@shared/tables'
import { ueTypes } from '@shared/table-types-ue'
import { parseStore, typeNode, type TValue } from '@shared/table-codec'
import { TypeEditor } from '@/components/tables/TypeEditor'
import { TypedValueForm } from '@/components/tables/TypedValueForm'

/** 样例：UE 常用类型 + 一个自定义的奖励结构体（演示数据不翻译） */
const SCHEMA = TableSchema.parse({
  types: {
    ...ueTypes(),
    Reward: {
      kind: 'struct',
      store: '{ItemID}:{Count}',
      fields: [
        { name: 'ItemID', type: 'int32' },
        { name: 'Count', type: 'int32', min: 1 },
      ],
    },
  },
})
const CODEC = { formats: SCHEMA.style.formats, listSep: ';' }

/**
 * 设置 → 组件里的类型编辑器和格子的逐项编辑：项目设置 → 表格 → 类型、表格页改结构体格子的弹窗用的同一套，
 * 外观跟着「输入框」「按钮」的微调走
 */
export function TypesSpecimen() {
  const [def, setDef] = useState(SCHEMA.types.Reward)
  const schema = useMemo(() => ({ ...SCHEMA, types: { ...SCHEMA.types, Reward: def } }), [def])
  const node = typeNode(SCHEMA, 'TArray<FColor>')
  const [value, setValue] = useState<TValue>(() => {
    const p = parseStore(node, '255,128,0;0,0,255,128', CODEC)
    return p.ok ? p.v : { items: [] }
  })
  return (
    <div className="tb:grid tb:gap-4 tb:lg:grid-cols-2">
      <TypeEditor name="Reward" value={def} onChange={setDef} onRename={() => {}} schema={schema} taken={new Set()} />
      <TypedValueForm node={node} value={value} onChange={setValue} label="Colors" />
    </div>
  )
}
