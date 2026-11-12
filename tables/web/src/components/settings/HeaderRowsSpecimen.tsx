import { useState } from 'react'
import type { HeaderRule } from '@shared/table-header'
import { HeaderRowsEditor } from '@/components/tables/HeaderRowsEditor'

/** 样例：常见的 5 行游戏配置表表头（演示数据不翻译） */
const SAMPLE: HeaderRule = {
  start: 0,
  rows: [
    { kind: 'modifier', label: '修饰', values: 'Modifier' },
    { kind: 'side', label: '导出端', values: 'Side' },
    { kind: 'type', values: '@types' },
    { kind: 'name' },
    { kind: 'comment' },
  ],
}

/**
 * 设置 → 组件里的表头配置编辑器：项目设置 → 表格 → 表头、表格页「调整表头」用的同一个，
 * 外观跟着「输入框」「按钮」的微调走
 */
export function HeaderRowsSpecimen() {
  const [value, setValue] = useState(SAMPLE)
  return <HeaderRowsEditor value={value} onChange={setValue} enumNames={['Modifier', 'Side']} />
}
