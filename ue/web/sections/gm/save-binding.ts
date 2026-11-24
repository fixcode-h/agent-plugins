import type { LuaGmBinding, LuaGmConfig, LuaGmScan } from '../../../server/lua-gm/types.ts'
import { ppost } from '../../api.ts'
import type { GmEntry, GmParam } from './data.ts'
import { storedTable } from './tables.ts'
import type { useGm } from './use-gm.ts'

/**
 * 存一个参数的表格关联（关联弹窗的「保存」、表格按钮右键「粘贴关联」共用）。
 * Lua GM 的关联存 Lua GM 配置，C++ GM 的存 gm.json（团队共用）；null 去掉关联
 */
export async function saveBinding(
  ctx: { projectId: string; d: ReturnType<typeof useGm> },
  target: { entry: GmEntry; p: GmParam },
  raw: LuaGmBinding | null | undefined,
) {
  const { projectId, d } = ctx
  // 表格路径存相对版本库根的（shared/gm/table-path.ts）；旧的绝对路径在这里换成相对的
  const b = raw && { ...raw, table: storedTable(projectId, raw.table) }
  const key = `${target.entry.name}.${target.p.name}`
  if (target.entry.src === 'lua') {
    const r = await ppost<{ config: LuaGmConfig; scan: LuaGmScan }>(projectId, 'lua-gm/config', {
      binding: { key, value: b },
    })
    d.lua.setData(r)
    return
  }
  // 改成关联表格后旧的 DataTable 绑定一起去掉
  const tableBindings = { ...d.gm.tableBindings }
  const bindings = { ...d.gm.bindings }
  delete bindings[key]
  if (b) tableBindings[key] = b
  else delete tableBindings[key]
  await d.saveGm({ ...d.gm, tableBindings, bindings })
}
