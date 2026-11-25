/**
 * 快照 → 给评审看的文本（面板 textify：评审里看 .uasset 改了什么）。编辑器开着时由桥接 asset.textify 导出，
 * 编辑器没开时用这份：同样是父类、接口、变量、组件、类默认值、每张图的伪代码，其他资源是属性、子对象和数据表的行。
 * 同一内容转出同样的文本（按名字排序、值用紧凑 JSON），面板拿两版的文本逐行比。
 */
import type { AssetSnap, SnapProp } from '../asset-diff/types.ts'

const val = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
const propLines = (props: SnapProp[], pad = '  ') => props.map((p) => `${pad}${p.name} = ${val(p.value)}`)

export function snapToText(s: AssetSnap): string {
  const out: string[] = [`Class: ${s.class}`]
  if (s.note) out.push(`# ${s.note}`)
  const bp = s.blueprint
  if (bp) {
    out.push(`Parent: ${bp.parent}`)
    if (bp.interfaces.length) out.push(`Interfaces: ${bp.interfaces.join(', ')}`)
    if (bp.variables.length) {
      out.push('', 'Variables:')
      for (const v of bp.variables)
        out.push(
          `  ${v.name}: ${v.type}${v.category ? ` [${v.category}]` : ''}${v.flags.length ? ` (${v.flags.join(', ')})` : ''}`,
        )
    }
    if (bp.components.length) {
      out.push('', 'Components:')
      for (const c of bp.components) {
        out.push(`  ${c.name} (${c.class}, ${c.source})${c.parent ? ` -> ${c.parent}` : ''}`)
        out.push(...propLines(c.props, '    '))
      }
    }
    if (bp.widgets?.length) {
      out.push('', 'Widgets:')
      for (const w of bp.widgets) {
        out.push(`  ${w.path} (${w.class})`)
        out.push(...propLines(w.props, '    '))
        if (w.slot?.length) out.push(`    [Slot ${w.slotClass ?? ''}]`, ...propLines(w.slot, '      '))
      }
    }
    out.push('', 'Class Defaults:', ...propLines(s.props))
    for (const g of bp.graphs)
      out.push('', `Graph ${g.name} (${g.kind}):`, ...g.pseudo.split('\n').map((l) => (l ? `  ${l}` : '')))
  } else {
    out.push('', 'Properties:', ...propLines(s.props))
    for (const o of s.subobjects ?? []) out.push('', `Subobject ${o.name} (${o.class}):`, ...propLines(o.props))
  }
  if (s.rows) {
    out.push('', `Rows (${s.rowStruct ?? ''}):`)
    for (const r of JSON.parse(s.rows) as Record<string, unknown>[]) {
      const { Name, ...rest } = r
      out.push(`  ${String(Name)}: ${JSON.stringify(rest)}`)
    }
  }
  return out.join('\n')
}
