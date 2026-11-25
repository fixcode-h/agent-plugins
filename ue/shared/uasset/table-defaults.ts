/**
 * 数据表的行在文件里只存「和行结构默认值不一样的列」：某行没写的列是默认值，所有行都没改过的列整列不出现。
 * 行结构的默认值文件里没有（C++ 结构在代码里，用户定义结构存在结构资源的编辑器数据里，格式是 UE 的文本），
 * 所以在编辑器开着时从编辑器读一次这张表，和文件里的行对一下：某行文件里没有、编辑器里有的那一列，编辑器给的就是默认值。
 * 记下来以后编辑器没开也能把整张表补全（server/uasset/defaults/）。
 */
import { mergeValue } from './inherit.ts'

/** 用户定义结构的成员在文件里带编号和 GUID（Health_2_8A9B…），编辑器里显示的是 Health */
export const columnKey = (k: string) => k.replace(/_\d+_[0-9A-F]{32}$/i, '')

export interface TableColumn {
  name: string
  type: string
  /** 记下的默认值；has 为 false 时这一列每行都改过，没机会知道默认值（也用不着） */
  value?: unknown
  has: boolean
}

type Row = Record<string, unknown>

/** 文件里的一行：列名换成编辑器里显示的名字 */
export function normRow(row: Row): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) out[columnKey(k)] = v
  return out
}

/**
 * 编辑器读的这张表（UELink datatable：columns + rows[{name, values}]）对文件里的行（已经 normRow 过），推出每列的默认值
 */
export function learnColumns(
  online: { columns?: { name: string; type?: string }[]; rows?: { name: string; values?: Row }[] },
  fileRows: Map<string, Row>,
): TableColumn[] {
  const cols: TableColumn[] = (online.columns ?? []).map((c) => ({ name: c.name, type: c.type ?? '', has: false }))
  for (const r of online.rows ?? []) {
    const f = fileRows.get(r.name)
    if (!f) continue
    for (const c of cols) {
      if (c.has || c.name in f || !r.values || !(c.name in r.values)) continue
      // 编辑器的 datatable 把长的格子截成摘要：不当默认值，换 datatable.row 取全的（prime.ts）
      const v = r.values[c.name]
      if (v && typeof v === 'object' && '_truncated' in v) continue
      c.value = v
      c.has = true
    }
  }
  return cols
}

/** 一行补全：按记下的列顺序，文件里没写的用默认值，结构体按成员合 */
export function fillRow(row: Row, cols: TableColumn[]): Row {
  const out: Row = {}
  for (const c of cols) {
    if (c.name in row) out[c.name] = c.has ? mergeValue(c.value, row[c.name]) : row[c.name]
    else if (c.has) out[c.name] = c.value
  }
  for (const [k, v] of Object.entries(row)) if (!(k in out)) out[k] = v
  return out
}
