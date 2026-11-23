/**
 * 配置的表头套不套到这张表上：表格目录里常混着辅助表、说明表、枚举表，它们本来就不是项目表头的格式，
 * 硬套上去会把数据行当表头、把字段名认错。所以按通配来的表头（项目表头、按通配的「按文件指定」）先拿这张表
 * 开头那几行比一比结构，对得上才套；只管这个工作表的那条是用户明确指定的，照用不比。
 *
 * 「对得上」只看表头每一行是不是它该有的样子（不按内容猜表头，只验证配置）：
 * - 修饰行：格子是这一行设的通用枚举里的值，或 arrayMarks、optional / repeated 这类修饰词；空格子不算
 * - 导出端行：格子是这一行设的通用枚举里的值，或 Client / Server / Public / C|S 这类写法；空格子不算
 * - 类型行：格子按类型表认得出来（基础类型、结构、枚举、TArray<…>、int[]），或是大驼峰的类型名
 * - 字段名行：不能整行空；格子是标识符（或中文列名）、不是数字，基本不重复，并且盖住这张表一半以上的列
 * - 注释、其它行：什么都能写，不比
 * 一行里非空格子至少 80% 符合才算这一行对得上；有一行对不上就整份不套。表比表头还短也不套（空表除外，新建的表还没内容）。
 */
import { typeNode } from './table-codec.ts'
import type { HeaderRow, HeaderRule } from './table-header.ts'
import { TYPE_NAMES, exceptionHits, type HeaderSource, type TableSchema } from './tables.ts'

/** 一行里至少这个比例的非空格子符合，才算这一行对得上（和面板自动识别表头用的比例一样） */
const RATIO = 0.8
/** 估表有多宽时往表头下面多看几行数据 */
const WIDTH_SCAN = 10

const MODIFIERS = new Set(['optional', 'repeated', 'required', 'packed', 'map', 'key', 'list', 'array']) // 模块状态：常量
// public / private 这类写法也常用来标导出端（两端都导 / 都不导）：漏了它，Public、Client 混着写的表整份表头套不上（用户 2026-11-23）
const SIDES = new Set([
  'client',
  'server',
  'editor',
  'all',
  'both',
  'none',
  'public',
  'private',
  'shared',
  'common',
  'c',
  's',
  'e',
  'cs',
  'sc',
  'ce',
  'se',
]) // 模块状态：常量
const IDENT = /^[A-Za-z_][A-Za-z0-9_.]*$/
const CJK = /[㐀-鿿豈-﫿]/
const NUM = /^[-+]?\d+(\.\d+)?$/
/** 类型表里没登记的类型名：大驼峰（FMyStruct、EColor）或带尖括号 / [] 的写法 */
const TYPE_LIKE = /^([A-Z][\w:.]*|[\w:.]+\s*<.*>)(\[\])?$/

/** 这份表头和这张表对不对得上；对不上时 row 是第一行对不上的表头行（从 0 数，在 rule.rows 里的位置） */
export interface HeaderFit {
  ok: boolean
  row?: number
}

const cellsOf = (row: string[] | undefined) => (row ?? []).map((c) => (c ?? '').trim()).filter(Boolean)

/** 这一行设的通用枚举能填的值（只认结构文件里记下的；从别的表读的枚举这里拿不到，就退回按写法看） */
function enumSet(schema: TableSchema, name: string | undefined) {
  if (!name || name === TYPE_NAMES) return undefined
  const e = schema.enums[name]
  const opts = [...(e?.scanned?.values ?? []), ...(e?.values ?? [])]
  if (!opts.length) return undefined
  const set = new Set<string>()
  for (const o of opts) {
    set.add(o.name.toLowerCase())
    if (o.value) set.add(o.value.toLowerCase())
  }
  return set
}

/** 一格是不是这一行该有的样子；undefined 表示这种行不比 */
function cellTest(schema: TableSchema, r: HeaderRow): ((v: string) => boolean) | undefined {
  const allowed = enumSet(schema, r.values)
  const inEnum = (v: string) => !!allowed?.has(v.toLowerCase())
  switch (r.kind) {
    case 'modifier': {
      const marks = new Set((schema.style.arrayMarks ?? []).map((m) => m.toLowerCase()))
      return (v) => inEnum(v) || MODIFIERS.has(v.toLowerCase()) || marks.has(v.toLowerCase())
    }
    case 'side':
      return (v) =>
        inEnum(v) ||
        v
          .toLowerCase()
          .split(/[|,/+\s]+/)
          .every((p) => p && SIDES.has(p))
    case 'type':
      return (v) => {
        const n = typeNode(schema, v)
        const known =
          !(n.k === 'scalar' && n.kind === 'other') && !(n.k === 'list' && n.of.k === 'scalar' && n.of.kind === 'other')
        return known || inEnum(v) || TYPE_LIKE.test(v)
      }
    case 'name':
      return (v) => !NUM.test(v) && (IDENT.test(v) || CJK.test(v))
    default:
      return undefined
  }
}

/** 一行表头对不对得上：true 对得上、false 对不上、undefined 不比（注释 / 其它行，或者整行空着的修饰、导出端行） */
function rowFits(schema: TableSchema, r: HeaderRow, row: string[] | undefined, width: number): boolean | undefined {
  const test = cellTest(schema, r)
  if (!test) return undefined
  const cells = cellsOf(row)
  // 字段名行必须有字；修饰、导出端、类型行整行空着说不出什么（这张表正好没有数组列），不比
  if (!cells.length) return r.kind === 'name' ? false : undefined
  let n = 0
  for (const c of cells) if (test(c)) n++
  if (n < cells.length * RATIO) return false
  // 字段名要能当列名用：基本不重复（数据行里常有一列重复的值），而且盖住这张表大半的列
  // （没字段名的备注列允许有，但只有一两格字的那行是标题、修饰行，不是字段名行）
  if (r.kind === 'name' && (new Set(cells).size < cells.length * 0.9 || cells.length < width * 0.5)) return false
  return true
}

/** 一份表头和这张表对不对得上（规则见文件开头） */
export function headerFit(schema: TableSchema, rule: HeaderRule, rows: string[][]): HeaderFit {
  if (!rule.rows.length || !rows.length) return { ok: true }
  if (rule.start + rule.rows.length > rows.length) {
    // 表比表头短：缺的第一行算对不上；字段名行都没有的表肯定不是这个格式
    const at = Math.max(0, rows.length - rule.start)
    return { ok: false, row: Math.min(at, rule.rows.length - 1) }
  }
  // 表有多宽：从表头起点往下看几行，取非空格子最多的那行
  let width = 0
  for (let r = rule.start; r < Math.min(rows.length, rule.start + rule.rows.length + WIDTH_SCAN); r++)
    width = Math.max(width, cellsOf(rows[r]).length)
  for (let i = 0; i < rule.rows.length; i++)
    if (rowFits(schema, rule.rows[i], rows[rule.start + i], width) === false) return { ok: false, row: i }
  return { ok: true }
}

/**
 * 一张表的表头从哪来：没套上时 source 是 unfit，tried 是本来要用的那份（按通配命中的第一条，或项目表头）、
 * fit 说是哪一行对不上；rule 是空的，整张表按数据显示
 */
export type PickedSource = HeaderSource | { kind: 'unfit'; tried: HeaderRule; from: HeaderSource; row?: number }

const emptyRule = (): HeaderRule => ({ start: 0, rows: [] })

/**
 * 按配置给一张表挑表头，并且只套对得上的：只管这个工作表的那条（用户点名的）直接用；
 * 按通配命中的几条和项目表头按优先级挨个比，第一份对得上的就用；一份都对不上就不套。
 * rows 不给（还没读到内容）时不比，和以前一样按优先级取
 */
export function pickHeader(
  s: TableSchema,
  file: string,
  sheet: string,
  rows?: string[][],
): { rule: HeaderRule; source: PickedSource } {
  let miss: { tried: HeaderRule; from: HeaderSource; row?: number } | undefined
  const exs = s.style.exceptions
  for (let i = 0; i < exs.length; i++) {
    const e = exs[i]
    if (!exceptionHits(e, file, sheet)) continue
    if (e.sheet !== undefined) return { rule: e.header, source: { kind: 'sheet', index: i } }
    const fit = rows ? headerFit(s, e.header, rows) : { ok: true }
    if (fit.ok) return { rule: e.header, source: { kind: 'file', index: i } }
    miss ??= { tried: e.header, from: { kind: 'file', index: i }, row: fit.row }
  }
  const fit = rows ? headerFit(s, s.style.header, rows) : { ok: true }
  if (fit.ok && (s.style.header.rows.length || !miss)) return { rule: s.style.header, source: { kind: 'project' } }
  miss ??= { tried: s.style.header, from: { kind: 'project' }, row: fit.row }
  return { rule: emptyRule(), source: { kind: 'unfit', ...miss } }
}
