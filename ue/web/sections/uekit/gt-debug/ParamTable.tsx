import { Table } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { LuaGmBinding } from '../../../../server/lua-gm/types.ts'
import { useUe } from '../../../ctx.tsx'
import { h, t } from '../../../host.ts'
import { TableBindDialog } from '../../gm/TableBindDialog.tsx'
import { TablePick } from '../../gm/TablePick.tsx'
import { labelOf, listTables, searchRows, storedTable, tableShape } from '../../gm/tables.ts'
import type { GmData } from '../../gm/use-gm.ts'

/**
 * 脚本参数关联表格（测试页梳理 F3）：和 GM 参数同一种关联（表格插件的一张表 + 主列 / 描述列），运行弹窗里出能搜的下拉。
 * 关联存 gm.json 的 tableBindings（团队共用），键 `gt:<场景>#<参数名>`，不写进脚本：脚本是 GameTest 读的，多一个字段它会报错
 */
export const paramBindKey = (scenario: string, param: string) => `gt:${scenario}#${param}`

export function ParamTable({
  gm,
  scenario,
  param,
  value,
  onChange,
  input,
}: {
  gm: GmData
  scenario: string
  param: string
  value: string
  onChange: (v: string) => void
  /** 没关联时的普通输入框 */
  input: ReactNode
}) {
  const { toast } = h()
  const project = useUe().project.id
  const key = paramBindKey(scenario, param)
  const b = gm.gm.tableBindings?.[key] as LuaGmBinding | undefined
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!b || !value) return
    labelOf(project, b, value).then(setLabel, () => undefined)
    // 只在关联、值变了时补描述
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [b?.table, b?.key, value])
  const save = async (raw: LuaGmBinding | null | undefined) => {
    const tableBindings = { ...gm.gm.tableBindings }
    if (raw) tableBindings[key] = { ...raw, table: storedTable(project, raw.table) }
    else delete tableBindings[key]
    try {
      await gm.saveGm({ ...gm.gm, tableBindings })
      setEditing(false)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <>
      {b ? (
        <TablePick
          value={value}
          label={label}
          binding={b}
          load={(q) => searchRows(project, b, q)}
          onChange={(v, l) => {
            setLabel(l)
            onChange(v)
          }}
          footer={
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ue:ml-auto ue:shrink-0 ue:cursor-pointer ue:text-accent-text ue:hover:underline"
            >
              {t('改关联')}
            </button>
          }
        />
      ) : (
        <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
          {input}
          <button
            type="button"
            title={t('关联表格的列：运行时下拉里按主列、描述列搜（和 GM 参数同一种关联，团队共用）')}
            onClick={() => setEditing(true)}
            className="ue:grid ue:shrink-0 ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
          >
            <Table className="ue:h-3.5 ue:w-3.5" />
          </button>
        </span>
      )}
      {editing && (
        <TableBindDialog
          param={param}
          current={b}
          load={{
            tables: (q) => listTables(project, q),
            shape: (table, sheet) => tableShape(project, table, sheet),
            rows: (x, q) => searchRows(project, x, q),
          }}
          onClose={() => setEditing(false)}
          onSave={(x) => void save(x ?? null)}
        />
      )}
    </>
  )
}
