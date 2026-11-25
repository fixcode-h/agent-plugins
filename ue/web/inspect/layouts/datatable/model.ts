/**
 * 数据表布局的纯逻辑（单测 datatable.test.ts）：单元格按值的样子挑显示方式（颜色块、勾选框、数字、数组个数、资源引用名、枚举标签），
 * 列头按 UE 类型排序；排序只在网页里，不改资源的行顺序（效果图 B1 注 1）。
 */
export interface Column {
  name: string
  type: string
  complex: boolean
}
export interface TableRow {
  name: string
  values: Record<string, unknown>
}
export interface Table {
  struct: string
  columns: Column[]
  rows: TableRow[]
  total: number
  dirty: boolean
  /** 编辑器没开、服务端直接读文件给的（server/uasset）：note 说明没写的格子是不是补全了 */
  offline?: boolean
  note?: string
}

export type Cell =
  | { kind: 'empty' }
  | { kind: 'bool'; on: boolean }
  | { kind: 'num'; text: string }
  | { kind: 'color'; css: string; hex: string }
  | { kind: 'count'; n: number }
  | { kind: 'ref'; name: string; path: string }
  | { kind: 'enum'; text: string }
  | { kind: 'text'; text: string }

/** 结构体字段不分大小写取（引擎的 JSON 转换把首字母改成小写：r / g / b / a） */
export function field(o: Record<string, unknown>, name: string): unknown {
  if (name in o) return o[name]
  const k = Object.keys(o).find((x) => x.toLowerCase() === name.toLowerCase())
  return k === undefined ? undefined : o[k]
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** 线性颜色 → sRGB 的 #rrggbb（UE 颜色选择器里显示的是 sRGB 十六进制） */
export function linearToHex(r: number, g: number, b: number) {
  const s = (c: number) => {
    const x = Math.min(1, Math.max(0, c))
    const v = x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${s(r)}${s(g)}${s(b)}`
}

/** 颜色结构体（FLinearColor 的 R/G/B/A、FColor 的 0–255）→ 显示用的 css 颜色；不是颜色返回 undefined */
export function colorOf(v: unknown, type = ''): { css: string; hex: string } | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const [r, g, b] = ['R', 'G', 'B'].map((k) => num(field(o, k)))
  if (r === undefined || g === undefined || b === undefined || Object.keys(o).length > 4) return undefined
  if (/FColor\b/.test(type) || r > 1 || g > 1 || b > 1) {
    const hex = `#${[r, g, b]
      .map((c) =>
        Math.round(Math.min(255, Math.max(0, c)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`
    return { css: hex, hex }
  }
  const hex = linearToHex(r, g, b)
  return { css: hex, hex }
}

/** 资源引用的显示名：/Game/UI/Icons/T_Icon_Sword.T_Icon_Sword → T_Icon_Sword；软引用的类前缀（Texture2D'…'）也去掉 */
export function refShort(s: string) {
  const inner = /^[\w]+'(.*)'$/.exec(s)?.[1] ?? s
  return inner.split(/[./:]/).pop() || inner
}

const isEnumType = (type: string) => /^(TEnumAsByte<)?E[A-Z]/.test(type)
export const isRef = (s: string) => /^(\w+')?\/(Game|Engine|Script)\//.test(s) || /^\/[A-Z]\w+\//.test(s)

/** 一个单元格怎么画 */
export function cellOf(v: unknown, type: string): Cell {
  if (v === null || v === undefined || v === '') return { kind: 'empty' }
  if (typeof v === 'boolean') return { kind: 'bool', on: v }
  if (typeof v === 'number') return { kind: 'num', text: fmtNum(v, type) }
  if (Array.isArray(v)) return { kind: 'count', n: v.length }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o._truncated) return typeof o._count === 'number' ? { kind: 'count', n: o._count } : { kind: 'text', text: '…' }
    const c = colorOf(v, type)
    if (c) return { kind: 'color', ...c }
    return { kind: 'text', text: JSON.stringify(v) }
  }
  const s = String(v)
  if (s === 'None' && /Ptr|\*/.test(type)) return { kind: 'empty' }
  if (isRef(s)) return { kind: 'ref', name: refShort(s), path: s }
  if (isEnumType(type)) return { kind: 'enum', text: s.replace(/^\w+::/, '') }
  return { kind: 'text', text: s }
}

/** 数字：整数类型加千分位，浮点两位小数（和效果图一样，原值在悬停提示里） */
export function fmtNum(v: number, type: string) {
  if (
    /^(int|uint|int64|uint8|int16|int32|uint16|uint32|uint64)\b/.test(type) ||
    (Number.isInteger(v) && !/float|double/.test(type))
  )
    return v.toLocaleString('en-US')
  return v.toFixed(2)
}

/** 排序用的键：数字按大小，数组按个数，其余按显示文字 */
function sortKey(v: unknown): number | string {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (Array.isArray(v)) return v.length
  if (v && typeof v === 'object') return JSON.stringify(v)
  return String(v ?? '').toLowerCase()
}

export type Sort = { col: string; desc: boolean } | undefined

/** 按列排序（col 为空是行名）；不改原数组 */
export function sortRows(rows: TableRow[], sort: Sort): TableRow[] {
  if (!sort) return rows
  const key = (r: TableRow) => (sort.col ? sortKey(r.values[sort.col]) : r.name.toLowerCase())
  const out = [...rows].sort((a, b) => {
    const x = key(a)
    const y = key(b)
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
    return sort.desc ? -c : c
  })
  return out
}

/** 点列头：没排 → 升序 → 降序 → 不排 */
export function nextSort(cur: Sort, col: string): Sort {
  if (!cur || cur.col !== col) return { col, desc: false }
  return cur.desc ? undefined : { col, desc: true }
}

/** 选中行的上一行 / 下一行（行编辑器的 ‹ › 按钮）；到头了返回 undefined */
export function stepRow(rows: TableRow[], cur: string, dir: 1 | -1) {
  const i = rows.findIndex((r) => r.name === cur)
  if (i < 0) return rows[0]?.name
  return rows[i + dir]?.name
}

/** 按属性路径（Stats.Mods[2].Value）从一行的值里取；取不到返回 undefined */
export function getAt(values: Record<string, unknown>, path: string): unknown {
  let cur: unknown = values
  for (const part of path.match(/[^.[\]]+|\[\d+\]/g) ?? []) {
    if (cur === null || typeof cur !== 'object') return undefined
    if (part.startsWith('[')) cur = (cur as unknown[])[Number(part.slice(1, -1))]
    else cur = field(cur as Record<string, unknown>, part)
  }
  return cur
}

/** 新元素的默认值：照已有元素的类型给空值（结构体给空对象，UELink 按结构体默认值补齐） */
function blankLike(v: unknown): unknown {
  if (typeof v === 'number') return 0
  if (typeof v === 'boolean') return false
  if (Array.isArray(v)) return []
  if (v && typeof v === 'object') return {}
  return ''
}

/**
 * 行编辑器里数组的加 / 插入 / 复制 / 删除 / 清空：datatable.set 只能整列写，所以在网页里算出新数组整个写回。
 * 返回新数组；动作不认识或下标越界时原样返回
 */
export function arrayEdit(arr: unknown[], action: string, index?: number): unknown[] {
  const out = [...arr]
  const i = index ?? out.length
  if (action === 'add') out.push(blankLike(out[out.length - 1]))
  else if (action === 'insert' && i <= out.length) out.splice(i, 0, blankLike(out[i] ?? out[0]))
  else if (action === 'duplicate' && i < out.length) out.splice(i + 1, 0, structuredClone(out[i]))
  else if (action === 'remove' && i < out.length) out.splice(i, 1)
  else if (action === 'clear') out.length = 0
  return out
}
