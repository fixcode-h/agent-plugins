import { useMemo, useState } from 'react'
import { op, useAction, useLoad } from '../../../api.ts'
import { useUe } from '../../../ctx.tsx'
import { toValue } from '../../../details/api.ts'
import type { Prop } from '../../../details/model.ts'
import type { DetailsApi } from '../../../details/rows.tsx'
import { arrayEdit, getAt } from './model.ts'

/** 这次在网页上改过的格子（表 | 行 | 属性路径 → 原值）：换行再回来还能重置 */
const changed = new Map<string, unknown>()

/**
 * 行编辑器的数据和动作：datatable.row 读这一行的全部字段（带分类、显示名、枚举选项，和细节面板同一种属性），
 * 改值走 datatable.set（属性路径能往里走：Stats.MaxHP、Tags[1]）；数组加删在网页里算出新数组整列写回（datatable.set 没有数组按钮）
 */
export function useRow(
  path: string,
  row: string,
  openRef: DetailsApi['openRef'],
  onChanged: () => void,
  /** 行结构名：成员没写分类时折叠条用它（UE 行编辑器也是按结构体名分组） */
  struct = '',
) {
  const { project } = useUe()
  const { busy, run } = useAction()
  const [version, setVersion] = useState(0)
  const data = useLoad(
    () =>
      row
        ? op<{ props: Prop[] }>(project.id, 'datatable.row', { path, row }).then((r) => ({
            key: `${path}|${row}`,
            ...r,
          }))
        : Promise.resolve(undefined),
    [project.id, path, row],
  )
  const raw = data.data?.key === `${path}|${row}` ? data.data.props : undefined
  const props = useMemo(() => raw?.map((p) => (p.category || !struct ? p : { ...p, category: struct })), [raw, struct])
  const values = useMemo(() => Object.fromEntries((props ?? []).map((p) => [p.name, p.value])), [props])
  const k = (p: string) => `${path}|${row}|${p}`
  const write = async (column: string, value: unknown) => {
    const r = await op<{ prev: unknown }>(project.id, 'datatable.set', { path, row, column, value })
    setVersion((v) => v + 1)
    void data.reload()
    onChanged()
    return r
  }
  const api: Omit<DetailsApi, 'q'> = {
    busy,
    version,
    changed: (p) => changed.get(k(p)),
    isChanged: (p) => changed.has(k(p)),
    setValue: (n, raw) =>
      void run(n.path, async () => {
        const r = await write(n.path, toValue(n, raw))
        if (!changed.has(k(n.path))) changed.set(k(n.path), r.prev)
      }),
    reset: (n) =>
      void run(n.path, async () => {
        if (!changed.has(k(n.path))) return
        await write(n.path, changed.get(k(n.path)))
        changed.delete(k(n.path))
      }),
    arrayOp: (p, action, index) =>
      void run(`${p}#array`, async () => {
        const cur = getAt(values, p)
        await write(p, arrayEdit(Array.isArray(cur) ? cur : [], action, index))
      }),
    openRef,
    loadFull: async (p) => getAt(values, p),
  }
  return { props, error: data.error, loading: data.loading, api, reload: () => void data.reload() }
}
