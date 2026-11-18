import { placeRows } from './rows.ts'

/**
 * 「核对选择器」要核对的选择器：每一步的 target、toTarget（和 GameTest 自己收的一样），录制段、如果、循环里的也收。
 * 按顺序交给 gt.resolve 的 targets，结果一项对一项，按 key 挂回行
 */
export function collectTargets(steps: Record<string, unknown>[]) {
  const out: { key: string; field: string; target: string }[] = []
  for (const r of placeRows(steps))
    for (const field of ['target', 'toTarget']) {
      const v = r.def[field]
      if (typeof v === 'string' && v.trim()) out.push({ key: r.key, field, target: v.trim() })
    }
  return out
}
