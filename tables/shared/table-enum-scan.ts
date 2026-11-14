/**
 * 枚举扫描：一条规则描述「去哪个文件、按什么写法、扫出一批枚举」（用户 2026-11-14 要求：枚举定义在表格的某个页签、
 * C++ 或 Lua 里时，按规则一键扫描，或者打开时自动刷新）。规则存在结构文件 enum-scans.json，扫出来的结果存在
 * enum-scan-results.json，读结构文件时并进对应枚举的 scanned（只读）；表格文件、源文件都不改。
 *
 * 写法（这里是纯函数和规则格式，服务端扫、单测都用它）：
 * - 表格里：block 分组块（枚举名只写在每组第一行，下面几行枚举名那列空着，属于上面那个枚举；用户项目的 EnumType 页签就是这样，没有表头）、
 *   rows 每行写枚举名、sheets 一页一个枚举（页签名或文件名就是枚举名）
 * - 代码里（table-enum-scan-code.ts）：cpp（UENUM / enum class / namespace 包着的 enum）、lua（枚举表）、regex（两个正则）
 * - command 自定义命令：内置写法表达不了时，跑项目里的脚本，它输出约定格式的 JSON
 */
import { z } from 'zod'
import { t } from './i18n.ts'
import type { SheetData } from './files.ts'

/** 一个成员：和 tables.ts 的 EnumValue 同样的形状（不从那边引，tables.ts 要引这里的规则，互相引会在加载时出错） */
export const ScanValue = z.object({
  name: z.string().trim().min(1).max(200),
  value: z.string().trim().max(60).optional(),
  desc: z.string().trim().max(500).optional(),
})
type EnumValue = z.infer<typeof ScanValue>

/** 默认跳过的哨兵成员：EFoo_MAX、MAX、Count、Num */
export const SKIP_SENTINEL = '(^|_)(MAX|Max|COUNT|Count|NUM|Num)$'

/** 代码类写法共用：哪些文件（相对项目目录的通配，逗号分隔，** 跨目录）、排除哪些 */
const CodeFiles = {
  files: z.string().max(1000).default(''),
  exclude: z.string().max(1000).default(''),
}

/** 列：Excel 列号（A、B、AA）或表头里的字段名 */
const Col = z.string().trim().max(200)

export const ScanFrom = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['block', 'rows']),
    file: z.string().trim().max(600),
    /** 页签名；空的是第一个页签 */
    sheet: z.string().trim().max(200).default(''),
    /** 从第几行开始（Excel 行号，1 起）；不写时从表头下面开始，没表头就从第 1 行 */
    start: z.number().int().min(1).max(1_000_000).optional(),
    enumCol: Col,
    nameCol: Col,
    valueCol: Col.optional(),
    descCol: Col.optional(),
  }),
  z.object({
    kind: z.literal('sheets'),
    file: z.string().trim().max(600),
    /** 哪些页签算枚举（通配，空的是全部）*/
    sheet: z.string().trim().max(200).default(''),
    /** 枚举名取页签名还是文件名（文件名时只取第一个对上的页签） */
    nameFrom: z.enum(['sheet', 'file']).default('sheet'),
    start: z.number().int().min(1).max(1_000_000).optional(),
    nameCol: Col,
    valueCol: Col.optional(),
    descCol: Col.optional(),
  }),
  z.object({
    kind: z.literal('cpp'),
    ...CodeFiles,
    /** 只要带 UENUM() 的（UE 项目里只给蓝图 / 反射用的枚举） */
    onlyUenum: z.boolean().default(false),
    /** 跳过 UMETA(Hidden) 的成员 */
    skipHidden: z.boolean().default(true),
    /** 跳过这些成员（正则）：_MAX、Count 这类哨兵 */
    skip: z.string().max(300).default(SKIP_SENTINEL),
    /** 说明取 UMETA(DisplayName / ToolTip) 还是行尾注释 */
    desc: z.enum(['meta', 'comment', 'none']).default('meta'),
  }),
  z.object({
    kind: z.literal('lua'),
    ...CodeFiles,
    /** 哪些变量名算枚举（正则，按最后一段比）；空的是「键都是名字、值都是数字或字符串」的表 */
    names: z.string().max(300).default(''),
    /** 枚举都放在一个总表下面时写它的名字（例如 Enums = { EColor = {...}, ... }），总表下每个子表是一个枚举 */
    container: z.string().max(200).default(''),
    /** 成员的值是表时（A = { id = 1, name = "…" }）：哪个字段当值、哪个当说明 */
    valueField: z.string().max(100).default(''),
    descField: z.string().max(100).default(''),
    skip: z.string().max(300).default(''),
  }),
  z.object({
    kind: z.literal('regex'),
    ...CodeFiles,
    /** 找一个枚举块：要有命名组 name（枚举名）和 body（成员那一段） */
    block: z.string().max(1000).default(''),
    /** 在 body 里找每个成员：要有命名组 name，可选 value、desc */
    member: z.string().max(1000).default(''),
    skip: z.string().max(300).default(''),
  }),
  z.object({
    kind: z.literal('command'),
    /** 在项目目录（或 cwd）里执行，标准输出是 {"enums":{"EFoo":[{"name":"A","value":"1","desc":"…"}]}} */
    command: z.string().max(2000).default(''),
    cwd: z.string().trim().max(300).default(''),
    timeoutSec: z.number().int().min(1).max(600).default(60),
    /** 自动扫时看哪些文件变没变（通配，逗号分隔）；空的只能手动扫 */
    files: z.string().max(1000).default(''),
    exclude: z.string().max(1000).default(''),
  }),
])
export type ScanFrom = z.infer<typeof ScanFrom>

/** 表格里的写法（读一个表格文件） */
export type SheetFrom = Extract<ScanFrom, { kind: 'block' | 'rows' | 'sheets' }>
export type CodeFrom = Extract<ScanFrom, { kind: 'cpp' | 'lua' | 'regex' }>
export const isSheetFrom = (f: ScanFrom): f is SheetFrom =>
  f.kind === 'block' || f.kind === 'rows' || f.kind === 'sheets'

/** 显示用：这条规则扫哪里 */
export const fromWhere = (f: ScanFrom) =>
  isSheetFrom(f) ? (f.sheet ? `${f.file} › ${f.sheet}` : f.file) : f.kind === 'command' ? f.command : f.files

/** 一条规则自动扫时要看的文件通配：表格类是那一个文件，代码类、命令是 files */
export const watchGlobs = (f: ScanFrom) => splitGlobs(isSheetFrom(f) ? f.file : f.files)
export const splitGlobs = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim().replace(/\\/g, '/'))
    .filter(Boolean)

/** 扫出来的名字怎么换成表格里用的枚举名（C++ 叫 EFoo、表格里写 Foo） */
export const ScanRename = z.object({
  stripPrefix: z.string().max(40).default(''),
  addPrefix: z.string().max(40).default(''),
  /** 少数对不上的手动对照：扫出来的名字 → 表格里的名字 */
  map: z.record(z.string().max(200), z.string().max(200)).default({}),
})
export type ScanRename = z.infer<typeof ScanRename>

/**
 * 什么时候自动扫：off 只手动；open 进表格页、打开这个文件时看源文件变没变，变了才扫；
 * watch 服务端盯着源文件所在的目录，一改就在后台扫并推给页面
 */
export const SCAN_AUTO = ['off', 'open', 'watch'] as const

export const EnumScan = z.object({
  id: z.string().trim().min(1).max(60),
  name: z.string().trim().max(60).default(''),
  from: ScanFrom,
  rename: ScanRename.default(() => ScanRename.parse({})),
  auto: z.enum(SCAN_AUTO).default('open'),
})
export type EnumScan = z.infer<typeof EnumScan>

/** 一条规则上次扫的结果（enum-scan-results.json 里按规则 id 记） */
export const ScanResult = z.object({
  at: z.string().max(40),
  /** 源文件当时的修改时间和大小：「打开时」只比这个，对上了不重扫 */
  files: z.record(z.string().max(600), z.object({ mtime: z.string().max(40), size: z.number() })).default({}),
  enums: z.record(z.string().max(200), z.array(ScanValue).max(5000)).default({}),
  warnings: z.array(z.string().max(500)).max(50).default([]),
  /** 这次扫失败了：旧的 enums 留着，标「过期」 */
  error: z.string().max(1000).optional(),
})
export type ScanResult = z.infer<typeof ScanResult>

export const ScanResults = z.record(z.string().max(60), ScanResult)
export type ScanResults = z.infer<typeof ScanResults>

export const scanName = (s: EnumScan) =>
  s.name.trim() ||
  fromWhere(s.from)
    .split(',')[0]
    .replace(/.*[\\/]/, '')
    .slice(0, 40) ||
  s.id

/** 新规则的 id：名字里看得懂的部分 + 随机后缀，不和已有的重 */
export function newScanId(have: { id: string }[]) {
  const ids = new Set(have.map((s) => s.id))
  for (;;) {
    const id = `scan-${Math.random().toString(36).slice(2, 8)}`
    if (!ids.has(id)) return id
  }
}

/** Excel 列号 → 从 0 数的列；不是列号返回 -1 */
export function colIndex(s: string) {
  if (!/^[A-Z]{1,3}$/.test(s)) return -1
  let n = 0
  for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1
}

/** 简单通配：* 任意多个字，? 一个字，不分大小写 */
export function globMatch(glob: string, s: string) {
  if (!glob || glob === '*') return true
  const re = new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
    'i',
  )
  return re.test(s)
}

export function renameEnum(name: string, r: ScanRename) {
  if (r.map[name]) return r.map[name]
  let n = name
  if (r.stripPrefix && n.startsWith(r.stripPrefix) && n.length > r.stripPrefix.length) n = n.slice(r.stripPrefix.length)
  return r.addPrefix + n
}

/** 一张表的「列」怎么找：列号直接用；字段名按表头的字段名行（names）找 */
interface SheetCols {
  /** 字段名行（没有表头时空数组） */
  names: string[]
  /** 数据从第几行开始（从 0 数） */
  dataFrom: number
}

const findCol = (col: string | undefined, c: SheetCols) => {
  if (!col) return -1
  const i = colIndex(col)
  return i >= 0 ? i : c.names.indexOf(col)
}

export interface SheetScan {
  enums: Record<string, EnumValue[]>
  warnings: string[]
}

const cell = (row: string[] | undefined, c: number) => (c >= 0 ? (row?.[c] ?? '').trim() : '')

/**
 * 按规则扫一个文件的工作表。headerOf 给出这张表的字段名行和数据起点（按项目的表头配置；枚举页签常常没有表头，
 * 这时 names 为空、dataFrom 为 0，列只能写列号）
 */
export function scanSheets(
  from: SheetFrom,
  sheets: SheetData[],
  headerOf: (sheet: SheetData) => SheetCols,
  fileName: string,
): SheetScan {
  const enums: Record<string, EnumValue[]> = {}
  const warnings: string[] = []
  const warn = (s: string) => warnings.length < 50 && warnings.push(s)
  const targets =
    from.kind === 'sheets'
      ? sheets.filter((s) => globMatch(from.sheet, s.name)).slice(0, from.nameFrom === 'file' ? 1 : undefined)
      : [from.sheet ? sheets.find((s) => s.name === from.sheet) : sheets[0]].filter((s): s is SheetData => !!s)
  if (!targets.length) {
    warn(from.sheet ? t('找不到页签「{sheet}」', { sheet: from.sheet }) : t('这个文件里没有页签'))
    return { enums, warnings }
  }
  for (const sheet of targets) {
    const h = headerOf(sheet)
    const nc = findCol(from.nameCol, h)
    const vc = findCol(from.valueCol, h)
    const dc = findCol(from.descCol, h)
    const ec = from.kind === 'sheets' ? -1 : findCol(from.enumCol, h)
    const miss = [
      nc < 0 && from.nameCol,
      from.valueCol && vc < 0 && from.valueCol,
      from.descCol && dc < 0 && from.descCol,
      from.kind !== 'sheets' && ec < 0 && from.enumCol,
    ].filter(Boolean)
    if (miss.length) {
      warn(t('页签「{sheet}」里找不到列：{cols}', { sheet: sheet.name, cols: miss.join('、') }))
      continue
    }
    if (sheet.truncated) warn(t('页签「{sheet}」太大，只扫了前面一部分', { sheet: sheet.name }))
    // 列全写成列号（A、B、C）时多半是没表头的枚举页签：项目表头不管它，从第 1 行开始扫
    const byName = [from.nameCol, from.valueCol, from.descCol, from.kind === 'sheets' ? '' : from.enumCol].some(
      (c) => c && colIndex(c) < 0,
    )
    const start = from.start !== undefined ? from.start - 1 : byName ? h.dataFrom : 0
    let cur = from.kind === 'sheets' ? (from.nameFrom === 'file' ? fileName.replace(/\.[^.]+$/, '') : sheet.name) : ''
    const seen = new Map<string, Set<string>>()
    let orphan = 0
    for (let r = start; r < sheet.rows.length; r++) {
      const row = sheet.rows[r]
      if (from.kind === 'block') {
        const e = cell(row, ec)
        if (e) cur = e
      } else if (from.kind === 'rows') cur = cell(row, ec)
      const name = cell(row, nc)
      if (!name) continue
      if (!cur) {
        orphan++
        continue
      }
      const list = (enums[cur] ??= [])
      const names = seen.get(cur) ?? seen.set(cur, new Set()).get(cur)!
      if (names.has(name)) {
        warn(t('{enum} 的成员 {name} 重复了（第 {row} 行），只留第一个', { enum: cur, name, row: r + 1 }))
        continue
      }
      if (list.length >= 5000) continue
      names.add(name)
      const value = cell(row, vc)
      const desc = cell(row, dc)
      list.push({ name, ...(value ? { value } : {}), ...(desc ? { desc } : {}) })
    }
    if (orphan) warn(t('页签「{sheet}」有 {n} 行成员前面没有枚举名，跳过了', { sheet: sheet.name, n: orphan }))
  }
  return { enums, warnings }
}

/** 扫出来的名字换成表格里的枚举名；换完撞名的合并并提醒 */
export function applyRename(scan: SheetScan, r: ScanRename): SheetScan {
  const enums: Record<string, EnumValue[]> = {}
  const warnings = [...scan.warnings]
  for (const [k, v] of Object.entries(scan.enums)) {
    const n = renameEnum(k, r)
    if (enums[n]) {
      warnings.push(t('{a} 换名后和别的枚举都叫 {b}，合在一起了', { a: k, b: n }))
      const have = new Set(enums[n].map((x) => x.name))
      enums[n].push(...v.filter((x) => !have.has(x.name)))
    } else enums[n] = v
  }
  return { enums, warnings }
}

/** 两次扫描之间的变化：新增 / 去掉的枚举，每个枚举加了、去掉了、值或说明变了的成员 */
export interface ScanDiff {
  added: string[]
  removed: string[]
  changed: { name: string; added: string[]; removed: string[]; modified: string[] }[]
  /** 看起来是改了名的成员（去掉的和新加的值一样，或者在同一个位置）：问用户要不要替换表格里的旧值 */
  renames?: { enum: string; from: string; to: string }[]
}

export function diffScan(
  before: Record<string, EnumValue[]> | undefined,
  after: Record<string, EnumValue[]>,
): ScanDiff {
  const old = before ?? {}
  const added = Object.keys(after).filter((k) => !old[k])
  const removed = Object.keys(old).filter((k) => !after[k])
  const changed: ScanDiff['changed'] = []
  const renames: NonNullable<ScanDiff['renames']> = []
  for (const k of Object.keys(after)) {
    if (!old[k]) continue
    const a = new Map(old[k].map((v) => [v.name, v]))
    const b = new Map(after[k].map((v) => [v.name, v]))
    const add = [...b.keys()].filter((n) => !a.has(n))
    const rm = [...a.keys()].filter((n) => !b.has(n))
    const mod = [...b.keys()].filter(
      (n) => a.has(n) && (a.get(n)!.value !== b.get(n)!.value || a.get(n)!.desc !== b.get(n)!.desc),
    )
    if (add.length || rm.length || mod.length) changed.push({ name: k, added: add, removed: rm, modified: mod })
    if (add.length && rm.length) renames.push(...guessRenames(k, old[k], after[k], new Set(add), new Set(rm)))
  }
  return { added, removed, changed, ...(renames.length ? { renames } : {}) }
}

/**
 * 去掉的成员和新加的成员配对成「改名」：先按值配（值一样只换了名字，最可靠），配不上的再按原来的位置配。
 * 只是猜测，替换表格前给用户逐条看
 */
function guessRenames(name: string, before: EnumValue[], after: EnumValue[], add: Set<string>, rm: Set<string>) {
  const out: { enum: string; from: string; to: string }[] = []
  const used = new Set<string>()
  const byValue = new Map<string, string>()
  for (const v of after)
    if (add.has(v.name) && v.value !== undefined && !byValue.has(v.value)) byValue.set(v.value, v.name)
  const left: EnumValue[] = []
  for (const v of before) {
    if (!rm.has(v.name)) continue
    const to = v.value !== undefined ? byValue.get(v.value) : undefined
    if (to && !used.has(to)) {
      used.add(to)
      out.push({ enum: name, from: v.name, to })
    } else left.push(v)
  }
  for (const v of left) {
    const i = before.indexOf(v)
    const to = after[i]?.name
    if (to && add.has(to) && !used.has(to) && after[i].value === undefined && v.value === undefined) {
      used.add(to)
      out.push({ enum: name, from: v.name, to })
    }
  }
  return out
}

export const diffEmpty = (d: ScanDiff) => !d.added.length && !d.removed.length && !d.changed.length

/** 变化说成一句话：「新增 2 个枚举，3 个枚举有改动」 */
export function diffLine(d: ScanDiff) {
  const parts = [
    d.added.length && t('新增 {n} 个枚举', { n: d.added.length }),
    d.removed.length && t('去掉 {n} 个枚举', { n: d.removed.length }),
    d.changed.length && t('{n} 个枚举有改动', { n: d.changed.length }),
  ].filter(Boolean)
  return parts.length ? parts.join('，') : t('没有变化')
}

/** 一次扫描（试跑或正式）交给页面的结果 */
export interface ScanRun {
  id: string
  enums: Record<string, EnumValue[]>
  warnings: string[]
  error?: string
  diff: ScanDiff
  at: string
}

/** 设置里规则那行显示的：上次扫的时间、出错、提醒、扫出几个枚举 */
export interface ScanState {
  at: string
  error?: string
  warnings: string[]
  enums: number
}
