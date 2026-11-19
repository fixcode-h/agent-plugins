import { HEAD } from '../../../../shared/forge-doc/sections.ts'

/**
 * 属性差异按段分组（设计稿 4.3.3）：只改了动画的版本只在「动画」下面有内容。
 * forge.diff 的属性路径第一节是段名（animations…、styles…）就归那段；asset、parent 这些头部字段归头；
 * 其余（控件、组件的属性，UE 回的是节点路径或属性名）都归主体段 root。
 */
const HEAD_FIELDS = new Set([
  'kind',
  'schemaVersion',
  'revision',
  'asset',
  'parent',
  'skeleton',
  'blackboard',
  '$schema',
])

export function diffSection(property: string, ids: readonly string[]) {
  const first = property.replace(/^props\./, '').split(/[.[/\s]/)[0]
  if (ids.includes(first)) return first
  if (HEAD_FIELDS.has(first)) return HEAD
  return 'root'
}

/** 按段分组，段的先后按段表（头最前），组里保持原来的顺序 */
export function groupBySection<T extends { property: string }>(rows: T[], ids: readonly string[]) {
  const order = [HEAD, ...ids]
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const id = diffSection(r.property, ids)
    if (!map.has(id)) map.set(id, [])
    map.get(id)!.push(r)
  }
  return [...map.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([id, list]) => ({ id, rows: list }))
}
