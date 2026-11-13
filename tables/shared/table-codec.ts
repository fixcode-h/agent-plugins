/**
 * 类型式和格子文字之间的来回换：表头类型行的类型式（TArray<FVector>、TMap<FName,int32>…）按类型表展开成一棵类型树，
 * 格子里存的字按「存储样式」拆成值，再按「显示样式」拼成给人看的字；弹窗里改完按存储样式拼回去写进格子。
 *
 * 只是读懂文字，不改文字：拆不开的格子原样显示、标成不合规。拆的时候认括号和双引号，
 * 所以结构体用 UE 那种 (X=1,Y=2) 存在数组里也拆得开。性能：类型树按「结构文件 + 类型式」缓存，
 * 5000 张表里同类型的列共用一棵；拆一格是一遍扫过去，不用正则回溯。
 */
import { t } from './i18n.ts'
import type { TableSchema } from './tables.ts'
import {
  defaultFormats,
  defaultShow,
  defaultStore,
  type ListFormat,
  type MapFormat,
  type TableType,
  type TypeFormats,
} from './table-types.ts'

export type ScalarKind = 'int' | 'uint' | 'float' | 'bool' | 'string' | 'enum' | 'other'

/** 叶子：一个值。字段和列结构的检查一样（范围、正则、枚举、引用） */
export interface ScalarNode {
  k: 'scalar'
  name: string
  kind: ScalarKind
  min?: number
  max?: number
  pattern?: string
  enumName?: string
  ref?: string
}
export interface StructField {
  name: string
  node: TypeNode
  optional: boolean
  def?: string
  note?: string
}
export interface StructNode {
  k: 'struct'
  name: string
  fields: StructField[]
  store: Tpl
  show: Tpl
}
export interface ListNode {
  k: 'list'
  of: TypeNode
  /** 集合：不许重复 */
  set: boolean
}
export interface MapNode {
  k: 'map'
  key: TypeNode
  val: TypeNode
}
export type TypeNode = ScalarNode | StructNode | ListNode | MapNode

/** 拆出来的值：叶子是字；结构体按字段；数组按项；映射按「键 → 值」 */
export type TValue = string | { f: Record<string, TValue> } | { items: TValue[] } | { pairs: [TValue, TValue][] }

/** 模板拆成的片段：字面的字或 {占位} */
export type Tpl = ({ lit: string } | { f: string })[]

export function compileTpl(s: string): Tpl {
  const out: Tpl = []
  const re = /\{([^{}]+)\}/g
  let at = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > at) out.push({ lit: s.slice(at, m.index) })
    out.push({ f: m[1].trim() })
    at = m.index + m[0].length
  }
  if (at < s.length) out.push({ lit: s.slice(at) })
  return out
}

/** 模板有什么问题：占位不是字段、必填字段没出现、两个占位挨着（拆不开） */
export function tplIssues(tpl: string, fields: { name: string; optional?: boolean }[]): string[] {
  const out: string[] = []
  const parts = compileTpl(tpl)
  const names = new Set(fields.map((f) => f.name))
  const used = new Set<string>()
  parts.forEach((p, i) => {
    if (!('f' in p)) return
    if (!names.has(p.f)) out.push(t('模板里的 {{f}} 不是字段', { f: p.f }))
    if (used.has(p.f)) out.push(t('{{f}} 写了两次', { f: p.f }))
    used.add(p.f)
    if (parts[i + 1] && 'f' in parts[i + 1])
      out.push(t('{{a}} 和 {{b}} 之间要有分隔的字', { a: p.f, b: (parts[i + 1] as { f: string }).f }))
  })
  for (const f of fields) if (!used.has(f.name) && !f.optional) out.push(t('字段 {f} 没写进模板', { f: f.name }))
  return out
}

const INT = /^(s?int(8|16|32|64)?|sfixed(32|64)|long|short|byte)$/i
const UINT = /^(uint(8|16|32|64)?|fixed(32|64)|ulong|ushort)$/i
const FLOAT = /^(float|double|number|real|decimal)$/i
const BOOL = /^(bool|boolean)$/i
const STRING = /^(string|bytes|text|str|fstring|fname|ftext)$/i
/** 定长整数自带的范围（64 位超出 JS 精度，不管） */
const INT_RANGE: Record<string, [number, number]> = {
  int8: [-128, 127],
  int16: [-32768, 32767],
  int32: [-2147483648, 2147483647],
  uint8: [0, 255],
  uint16: [0, 65535],
  uint32: [0, 4294967295],
  byte: [0, 255],
}

/** 一个名字是什么基础类型（不看类型表）：整数、非负整数、小数、布尔、文字；都不是就是 undefined */
export function builtinKind(name: string, primitives: string[] = []): ScalarKind | undefined {
  if (INT.test(name)) return 'int'
  if (UINT.test(name)) return 'uint'
  if (FLOAT.test(name)) return 'float'
  if (BOOL.test(name)) return 'bool'
  if (STRING.test(name) || primitives.includes(name)) return 'string'
  return undefined
}

const LIST_NAMES = new Set(['tarray', 'array', 'list', 'vector', 'repeated'])
const SET_NAMES = new Set(['tset', 'set'])
const MAP_NAMES = new Set(['tmap', 'map', 'dict', 'dictionary'])

/** 按深度为 0 的逗号拆（尖括号里的不拆）：TMap<FName, TArray<int32>> 的两个参数 */
function splitArgs(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let at = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '<') depth++
    else if (c === '>') depth--
    else if (c === ',' && depth === 0) {
      out.push(s.slice(at, i).trim())
      at = i + 1
    }
  }
  out.push(s.slice(at).trim())
  return out
}

/** 类型名在类型表里找（先原名，再别名，都不分大小写） */
export function findType(types: Record<string, TableType>, name: string): [string, TableType] | undefined {
  if (types[name]) return [name, types[name]]
  const low = name.toLowerCase()
  for (const [n, d] of Object.entries(types)) {
    if (n.toLowerCase() === low || d.aliases?.some((a) => a.toLowerCase() === low)) return [n, d]
  }
  return undefined
}

interface Env {
  schema: TableSchema
  formats: TypeFormats
}

/** 类型式 → 类型树；depth 防循环引用（A 的字段是 B、B 的字段是 A） */
function resolve(expr: string, env: Env, depth: number): TypeNode {
  const s = expr.trim()
  if (depth > 8) return { k: 'scalar', name: s, kind: 'other' }
  const arr = /^(.+?)\s*\[\]$/.exec(s)
  if (arr) return { k: 'list', of: resolve(arr[1], env, depth + 1), set: false }
  const gen = /^([\w:.]+)\s*<(.*)>$/.exec(s)
  if (gen) {
    const head = gen[1].toLowerCase()
    const args = splitArgs(gen[2])
    if (LIST_NAMES.has(head)) return { k: 'list', of: resolve(args[0] ?? '', env, depth + 1), set: false }
    if (SET_NAMES.has(head)) return { k: 'list', of: resolve(args[0] ?? '', env, depth + 1), set: true }
    if (MAP_NAMES.has(head) && args.length === 2)
      return { k: 'map', key: resolve(args[0], env, depth + 1), val: resolve(args[1], env, depth + 1) }
    // TSoftObjectPtr<UTexture2D> 这类：按外层的名字找，参数只是提示
    return resolve(gen[1], env, depth + 1)
  }
  const found = findType(env.schema.types ?? {}, s)
  if (found) return fromType(found[0], found[1], env, depth)
  if (env.schema.enums[s]) return { k: 'scalar', name: s, kind: 'enum', enumName: s }
  const kind = builtinKind(s, env.schema.style.primitives)
  const range = INT_RANGE[s.toLowerCase()]
  return { k: 'scalar', name: s, kind: kind ?? 'other', min: range?.[0], max: range?.[1] }
}

function fromType(name: string, d: TableType, env: Env, depth: number): TypeNode {
  if (d.kind === 'alias') return d.of ? resolve(d.of, env, depth + 1) : { k: 'scalar', name, kind: 'other' }
  if (d.kind !== 'struct') return { k: 'scalar', name, kind: d.kind, min: d.min, max: d.max, pattern: d.pattern }
  const defs = d.fields ?? []
  const fields: StructField[] = defs.map((f) => {
    let node = resolve(f.type, env, depth + 1)
    // 字段上设的范围、枚举、引用盖在字段类型上（只对叶子有意义）
    if (node.k === 'scalar' && (f.min !== undefined || f.max !== undefined || f.enum || f.ref))
      node = {
        ...node,
        min: f.min ?? node.min,
        max: f.max ?? node.max,
        ...(f.enum ? { kind: 'enum' as const, enumName: f.enum } : {}),
        ref: f.ref ?? node.ref,
      }
    return { name: f.name, node, optional: !!f.optional, def: f.default, note: f.note }
  })
  return {
    k: 'struct',
    name,
    fields,
    store: compileTpl(d.store || defaultStore(defs, env.formats.field)),
    show: compileTpl(d.show || defaultShow(defs)),
  }
}

const cache = new WeakMap<TableSchema, Map<string, TypeNode>>()

/** 类型式展开成类型树（按结构文件缓存：结构文件一变就是新对象，自动作废） */
export function typeNode(schema: TableSchema, expr: string): TypeNode {
  let m = cache.get(schema)
  if (!m) cache.set(schema, (m = new Map()))
  const hit = m.get(expr)
  if (hit) return hit
  const node = resolve(expr, { schema, formats: schema.style.formats ?? defaultFormats() }, 0)
  m.set(expr, node)
  return node
}

/** 要按类型拆的列：结构体、映射，或数组里套着这些（纯基础类型的数组照旧按分隔符处理） */
export function isComplex(n: TypeNode): boolean {
  if (n.k === 'struct' || n.k === 'map') return true
  if (n.k === 'list') return n.of.k !== 'scalar'
  return false
}

/** 拆一格时的写法：存储（拆、拼回格子）或显示（只拼） */
export interface Codec {
  formats: TypeFormats
  /** 最外层数组存储时的分隔符（列结构 > 项目 listSep） */
  listSep: string
}

/** 找 lit 第一次出现在括号、引号外面的位置 */
function findTop(s: string, lit: string, from: number): number {
  let depth = 0
  let quote = false
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === '"') quote = false
      continue
    }
    if (depth === 0 && s.startsWith(lit, i)) return i
    if (c === '"') quote = true
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1)
  }
  return -1
}

function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let at = 0
  for (let i = findTop(s, sep, 0); i >= 0; i = findTop(s, sep, at)) {
    out.push(s.slice(at, i))
    at = i + sep.length
  }
  out.push(s.slice(at))
  return out
}

/** 按模板拆：每个占位取到下一段字面的字为止（括号、引号里的不算） */
function matchTpl(tpl: Tpl, s: string): Record<string, string> | string {
  const out: Record<string, string> = {}
  let i = 0
  for (let k = 0; k < tpl.length; k++) {
    const p = tpl[k]
    if ('lit' in p) {
      if (s.startsWith(p.lit, i)) i += p.lit.length
      else if (s.trim().startsWith(p.lit.trim(), i) && p.lit.trim())
        i = s.indexOf(p.lit.trim(), i) + p.lit.trim().length
      else return t('少了「{lit}」', { lit: p.lit })
      continue
    }
    const next = tpl[k + 1]
    if (!next || !('lit' in next)) {
      out[p.f] = s.slice(i).trim()
      i = s.length
      continue
    }
    const j = findTop(s, next.lit, i)
    if (j < 0) {
      // 后面都没了：剩下的字段当没写（可选字段允许省略）
      out[p.f] = s.slice(i).trim()
      i = s.length
      break
    }
    out[p.f] = s.slice(i, j).trim()
    i = j
  }
  if (s.slice(i).trim()) return t('多出来「{rest}」', { rest: s.slice(i).trim() })
  return out
}

function unwrap(s: string, open: string, close: string): string {
  const x = s.trim()
  if (open && close && x.startsWith(open) && x.endsWith(close)) return x.slice(open.length, x.length - close.length)
  return x
}

export type Parsed = { ok: true; v: TValue } | { ok: false; err: string }

const fail = (err: string, at?: string): Parsed => ({ ok: false, err: at ? `${at}：${err}` : err })

/** 格子里存的字 → 值。depth 是套在几层数组、映射里（第二层起数组用 listStore.inner 当分隔符） */
export function parseStore(n: TypeNode, s: string, c: Codec, depth = 0): Parsed {
  if (n.k === 'scalar') return { ok: true, v: s.trim() }
  if (n.k === 'struct') {
    const got = matchTpl(n.store, s.trim())
    if (typeof got === 'string') return fail(got)
    const f: Record<string, TValue> = {}
    for (const fd of n.fields) {
      const raw = got[fd.name]
      if (raw === undefined || raw === '') {
        if (!fd.optional && fd.node.k === 'scalar') return fail(t('不能空着'), fd.name)
        f[fd.name] = emptyValue(fd.node)
        continue
      }
      // 结构体不算一层容器：结构体里的数组仍用最外层的分隔符
      const sub = parseStore(fd.node, raw, c, depth)
      if (!sub.ok) return fail(sub.err, fd.name)
      f[fd.name] = sub.v
    }
    return { ok: true, v: { f } }
  }
  if (n.k === 'list') {
    const ls = c.formats.listStore
    const body = unwrap(s, ls.open, ls.close)
    if (!body.trim()) return { ok: true, v: { items: [] } }
    const sep = depth === 0 ? c.listSep : ls.inner
    const items: TValue[] = []
    const seen = new Set<string>()
    const parts = splitTop(body, sep)
    for (let i = 0; i < parts.length; i++) {
      const sub = parseStore(n.of, parts[i], c, depth + 1)
      if (!sub.ok) return fail(sub.err, t('第 {n} 项', { n: i + 1 }))
      const key = parts[i].trim()
      if (n.set && seen.has(key)) return fail(t('集合里「{v}」重复了', { v: key }))
      seen.add(key)
      items.push(sub.v)
    }
    return { ok: true, v: { items } }
  }
  const ms = c.formats.mapStore
  const body = unwrap(s, ms.open, ms.close)
  if (!body.trim()) return { ok: true, v: { pairs: [] } }
  const entry = compileTpl(ms.entry)
  const pairs: [TValue, TValue][] = []
  const seen = new Set<string>()
  const parts = splitTop(body, ms.sep)
  for (let i = 0; i < parts.length; i++) {
    const kv = matchTpl(entry, parts[i].trim())
    if (typeof kv === 'string') return fail(kv, t('第 {n} 对', { n: i + 1 }))
    const k = parseStore(n.key, kv.K ?? '', c, depth + 1)
    if (!k.ok) return fail(k.err, t('第 {n} 对的键', { n: i + 1 }))
    const v = parseStore(n.val, kv.V ?? '', c, depth + 1)
    if (!v.ok) return fail(v.err, t('第 {n} 对的值', { n: i + 1 }))
    const key = (kv.K ?? '').trim()
    if (seen.has(key)) return fail(t('键「{k}」重复了', { k: key }))
    seen.add(key)
    pairs.push([k.v, v.v])
  }
  return { ok: true, v: { pairs } }
}

/** 空值：弹窗里新加一项时用；结构体按字段的默认值 */
export function emptyValue(n: TypeNode): TValue {
  if (n.k === 'scalar') return ''
  if (n.k === 'struct') return { f: Object.fromEntries(n.fields.map((f) => [f.name, f.def ?? emptyValue(f.node)])) }
  if (n.k === 'list') return { items: [] }
  return { pairs: [] }
}

const asF = (v: TValue) => (typeof v === 'object' && 'f' in v ? v.f : {})
const asItems = (v: TValue) => (typeof v === 'object' && 'items' in v ? v.items : [])
const asPairs = (v: TValue) => (typeof v === 'object' && 'pairs' in v ? v.pairs : [])

function fillTpl(tpl: Tpl, get: (f: string) => string) {
  return tpl.map((p) => ('lit' in p ? p.lit : get(p.f))).join('')
}

/** 值 → 存进格子的字 */
export function formatStore(n: TypeNode, v: TValue, c: Codec, depth = 0): string {
  if (n.k === 'scalar') return typeof v === 'string' ? v.trim() : ''
  if (n.k === 'struct') {
    const f = asF(v)
    const byName = new Map(n.fields.map((x) => [x.name, x]))
    return fillTpl(n.store, (name) => {
      const fd = byName.get(name)
      return fd ? formatStore(fd.node, f[name] ?? emptyValue(fd.node), c, depth) : ''
    })
  }
  if (n.k === 'list') {
    const ls = c.formats.listStore
    const items = asItems(v)
    if (!items.length) return ''
    const sep = depth === 0 ? c.listSep : ls.inner
    return ls.open + items.map((x) => formatStore(n.of, x, c, depth + 1)).join(sep) + ls.close
  }
  const ms = c.formats.mapStore
  const pairs = asPairs(v)
  if (!pairs.length) return ''
  const entry = compileTpl(ms.entry)
  return (
    ms.open +
    pairs
      .map(([k, x]) =>
        fillTpl(entry, (p) =>
          p === 'K' ? formatStore(n.key, k, c, depth + 1) : p === 'V' ? formatStore(n.val, x, c, depth + 1) : '',
        ),
      )
      .join(ms.sep) +
    ms.close
  )
}

/** 显示时文字里带括号、逗号、等号就加引号（同 UE 的写法），免得看着像结构 */
const showScalar = (s: string) => (/[(),=]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)

/** 值 → 表格页里显示的字 */
export function formatShow(n: TypeNode, v: TValue, f: TypeFormats): string {
  if (n.k === 'scalar') return showScalar(typeof v === 'string' ? v : '')
  if (n.k === 'struct') {
    const vals = asF(v)
    const byName = new Map(n.fields.map((x) => [x.name, x]))
    return fillTpl(n.show, (name) => {
      const fd = byName.get(name)
      if (!fd) return ''
      const x = vals[name]
      return x === '' && fd.def !== undefined ? fd.def : formatShow(fd.node, x ?? emptyValue(fd.node), f)
    })
  }
  if (n.k === 'list')
    return wrap(
      f.listShow,
      asItems(v).map((x) => formatShow(n.of, x, f)),
    )
  const entry = compileTpl(f.mapShow.entry)
  return wrap(
    f.mapShow,
    asPairs(v).map(([k, x]) =>
      fillTpl(entry, (p) => (p === 'K' ? formatShow(n.key, k, f) : p === 'V' ? formatShow(n.val, x, f) : '')),
    ),
  )
}
const wrap = (w: ListFormat | MapFormat, parts: string[]) => w.open + parts.join(w.sep) + w.close

/** 存的字直接换成显示的字；拆不开就原样（格子另外标红） */
export function storeToShow(n: TypeNode, s: string, c: Codec): string {
  if (!s.trim()) return s
  const p = parseStore(n, s, c)
  return p.ok ? formatShow(n, p.v, c.formats) : s
}

/** 每个叶子值走一遍（检查范围、枚举、引用用）；at 是给人看的位置（「第 2 项 · Y」） */
export function eachLeaf(
  n: TypeNode,
  v: TValue,
  fn: (leaf: ScalarNode, text: string, at: string) => string | undefined,
  at = '',
): string | undefined {
  const join = (a: string, b: string) => (a ? `${a} · ${b}` : b)
  if (n.k === 'scalar') return typeof v === 'string' && v ? fn(n, v, at) : undefined
  if (n.k === 'struct') {
    const f = asF(v)
    for (const fd of n.fields) {
      const bad = eachLeaf(fd.node, f[fd.name] ?? '', fn, join(at, fd.name))
      if (bad) return bad
    }
    return undefined
  }
  if (n.k === 'list') {
    const items = asItems(v)
    for (let i = 0; i < items.length; i++) {
      const bad = eachLeaf(n.of, items[i], fn, join(at, t('第 {n} 项', { n: i + 1 })))
      if (bad) return bad
    }
    return undefined
  }
  const pairs = asPairs(v)
  for (let i = 0; i < pairs.length; i++) {
    const bad =
      eachLeaf(n.key, pairs[i][0], fn, join(at, t('第 {n} 对的键', { n: i + 1 }))) ??
      eachLeaf(n.val, pairs[i][1], fn, join(at, t('第 {n} 对的值', { n: i + 1 })))
    if (bad) return bad
  }
  return undefined
}

/** 类型树的一句话：TArray<FVector{X,Y,Z}>，列结构、提示里用 */
export function nodeText(n: TypeNode): string {
  if (n.k === 'scalar') return n.name
  if (n.k === 'struct') return n.name
  if (n.k === 'list') return `${n.set ? 'TSet' : 'TArray'}<${nodeText(n.of)}>`
  return `TMap<${nodeText(n.key)}, ${nodeText(n.val)}>`
}
