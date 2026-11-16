import { Table2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { LuaGmBinding } from '../../../server/lua-gm/types.ts'
import { t } from '../../host.ts'
import { SearchPick } from './SearchPick.tsx'
import type { TableRow } from './tables.ts'

/** 「主列、描述列、辅助描述列」写成一句：搜索框的提示和下拉顶上的说明用 */
export function colsText(b: LuaGmBinding) {
  return [b.key, b.label, ...(b.extra ?? [])].filter(Boolean).join(' / ')
}

/**
 * 关联了表格列的参数：可搜索的下拉（设计稿 4.2，效果图 1）。按主列、描述列、辅助描述列搜，
 * 一行显示主列的值、描述和辅助描述。数据由 load 给（GM 页里是 tables.ts 经面板动作读表格插件），
 * 组件本身不管从哪来，设置 →「组件」里用假数据展示。搜不到时回车用输入的文字当值
 */
export function TablePick({
  value,
  label,
  binding,
  load,
  onChange,
  footer,
  placeholder,
}: {
  value: string
  /** 当前值对应的描述（「1001 · 新手长剑」里的后半） */
  label?: string
  binding: LuaGmBinding
  load: (q: string) => Promise<{ rows: TableRow[]; total: number }>
  onChange: (v: string, label: string) => void
  /** 下拉底部的说明（关联从哪来、改关联的入口） */
  footer?: ReactNode
  placeholder?: string
}) {
  const fileName = binding.table.split('/').pop() ?? ''
  const where = binding.sheet ? `${fileName} · ${binding.sheet}` : fileName
  const cols = colsText(binding)
  return (
    <SearchPick
      value={value}
      allowFree
      load={load}
      onPick={(r) => onChange(r.key, r.label)}
      searchPlaceholder={cols}
      trigger={
        value ? (
          <>
            <span className="ue:font-mono ue:text-fg">{value}</span>
            {label && <span className="ue:text-muted"> · {label}</span>}
          </>
        ) : (
          <span className="ue:text-subtle">{placeholder ?? t('搜 {cols}', { cols })}</span>
        )
      }
      side={
        <>
          <Table2 className="ue:h-3 ue:w-3 ue:shrink-0" />
          <span className="ue:truncate">
            {where} · {binding.key}
          </span>
        </>
      }
      summary={({ q, n, total }) =>
        q ? t('{file} · 含「{q}」· {n} 行', { file: where, q, n: total }) : t('{file} · 前 {n} 行', { file: where, n })
      }
      head={binding.extra?.length ? binding.extra.join(' · ') : undefined}
      empty={t('这张表没有数据')}
      footer={footer}
    />
  )
}

/** 设置 →「组件」里的示例：假数据，不连表格插件 */
export const DEMO_ROWS: TableRow[] = [
  { key: '1001', label: '新手长剑', extra: ['普通', '武器'] },
  { key: '1002', label: '精钢长剑', extra: ['优秀', '武器'] },
  { key: '1010', label: '寒霜之剑', extra: ['稀有', '武器'] },
  { key: '1022', label: '赤焰巨剑', extra: ['史诗', '武器'] },
  { key: '2001', label: '皮甲', extra: ['普通', '护甲'] },
  { key: '3001', label: '小生命药水', extra: ['普通', '消耗品'] },
]
export const demoLoad = async (q: string) => {
  const rows = DEMO_ROWS.filter((r) => !q || [r.key, r.label, ...r.extra].some((x) => x.includes(q)))
  return { rows, total: rows.length }
}
export function TablePickSpecimen() {
  const [v, setV] = useState({ key: '1001', label: '新手长剑' })
  return (
    <div className="ue:w-full ue:max-w-md ue:pb-72">
      <TablePick
        value={v.key}
        label={v.label}
        binding={{ table: 'Config/Item.xlsx', sheet: 'Item', key: 'Id', label: 'Name', extra: ['Quality', 'Type'] }}
        load={demoLoad}
        onChange={(key, label) => setV({ key, label })}
        footer={<span>{t('关联 itemId → Item.xlsx 的 Id')}</span>}
      />
    </div>
  )
}
