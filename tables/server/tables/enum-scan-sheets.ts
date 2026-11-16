/**
 * 表格类枚举规则的批量扫描：file 写成通配（Project/Excel/**\/*.xlsx）时，在表格目录里找全部对上的表格，
 * 每个文件里有规则写的页签就按同一种写法扫（用户 2026-11-16：枚举由 AI 总结出一条扫描规则，之后按规则批量扫所有表格得出枚举，
 * 不让 AI 分析所有表格把枚举逐个列出来）。没有这个页签的文件跳过；同名枚举出现在几个文件里时用排在前面的、记提醒。
 * 每个文件的结果按（文件, 规则, 表头配置）缓存，修改时间和大小没变就不重读；有页签名时先只看 workbook.xml 的页签清单，
 * 不解析整张表，几百张表的项目也只真正解析有枚举页签的那几个。
 */
import { readFile, stat } from 'node:fs/promises'
import { t } from '../../shared/i18n.ts'
import { globMatch, scanSheets, sheetRuleUses, type SheetFrom, type SheetScan } from '../../shared/table-enum-scan.ts'
import { sheetFieldNames } from '../../shared/table-struct.ts'
import type { TableSchema, TablesConfig } from '../../shared/tables.ts'
import { listTables, openTable, tableFull } from './files.ts'
import { entryText, readZip } from './zip.ts'
import type { SrcFile } from './enum-scan-files.ts'

interface Ctx {
  dir: string
  cfg: TablesConfig
  schema: TableSchema
}

/** 表格目录里对上这条规则通配的表格文件（老的 .xls 读不了，跳过） */
export async function sheetRuleFiles(ctx: Ctx, from: SheetFrom): Promise<SrcFile[]> {
  const { files } = await listTables(ctx.dir, ctx.cfg)
  const out: SrcFile[] = []
  for (const f of files) {
    if (f.kind === 'xls' || !sheetRuleUses(from, f.path)) continue
    const full = tableFull(ctx.dir, f.path)
    const st = await stat(full).catch(() => null)
    if (st?.isFile()) out.push({ rel: f.path, full, mtime: st.mtime.toISOString(), size: st.size })
  }
  return out
}

const unxml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** 规则要的页签这个文件里可能有吗：xlsx 只读 workbook.xml 的页签名；读不出来、CSV 都当可能有（交给完整解析） */
async function mayHaveSheet(f: SrcFile, from: SheetFrom) {
  if (!from.sheet || !/\.xlsx$/i.test(f.rel)) return true
  try {
    const xml = entryText(readZip(await readFile(f.full)), 'xl/workbook.xml')
    if (xml === null) return true
    const names = [...xml.matchAll(/<sheet\b[^>]*?\sname="([^"]*)"/g)].map((m) => unxml(m[1]))
    return names.some((n) => (from.kind === 'sheets' ? globMatch(from.sheet, n) : n === from.sheet))
  } catch {
    return true
  }
}

const cache = new Map<string, { stamp: string; got: SheetScan | null }>()
const CACHE_MAX = 20000

/** 一个文件按规则扫；没有规则要的页签时返回 null（批量扫时不算问题） */
async function scanOneFile(ctx: Ctx, from: SheetFrom, f: SrcFile): Promise<SheetScan | null> {
  if (!(await mayHaveSheet(f, from))) return null
  const doc = await openTable(ctx.dir, f.rel, ctx.cfg)
  const has = from.sheet
    ? doc.sheets.some((s) => (from.kind === 'sheets' ? globMatch(from.sheet, s.name) : s.name === from.sheet))
    : doc.sheets.length > 0
  if (!has) return null
  return scanSheets(
    from,
    doc.sheets,
    (sheet) => {
      const h = sheetFieldNames(ctx.schema, doc.path, sheet)
      return { names: h.names, dataFrom: h.from }
    },
    f.rel.replace(/.*\//, ''),
  )
}

/** 批量扫：逐个文件扫再合并。一个文件都没有这个页签时报错（多半是页签名或通配写错了） */
export async function scanSheetGlob(ctx: Ctx, from: SheetFrom): Promise<SheetScan & { files: SrcFile[] }> {
  const files = await sheetRuleFiles(ctx, from)
  if (!files.length) throw new Error(t('「{glob}」在表格目录里没对上任何表格', { glob: from.file }))
  // 表头配置变了，按字段名找列的结果可能不一样：一起算进缓存的键
  const key = JSON.stringify([from, ctx.schema.style.header, ctx.schema.style.exceptions])
  const enums: SheetScan['enums'] = {}
  const warnings: string[] = []
  const where = new Map<string, string>()
  let hit = 0
  for (const f of files) {
    const ck = `${f.full}\u0000${key}`
    const stamp = `${f.mtime}\u0000${f.size}`
    const old = cache.get(ck)
    let got = old?.stamp === stamp ? old.got : undefined
    if (got === undefined) {
      try {
        got = await scanOneFile(ctx, from, f)
      } catch (e) {
        // 一个文件读坏了不让整条规则失败：记提醒，别的文件照扫
        warnings.push(t('{file} 读不出来：{error}', { file: f.rel, error: (e as Error).message }))
        continue
      }
      if (cache.size > CACHE_MAX) cache.clear()
      cache.set(ck, { stamp, got })
    }
    if (!got) continue
    hit++
    warnings.push(...got.warnings.map((w) => `${f.rel}：${w}`))
    for (const [name, list] of Object.entries(got.enums)) {
      if (enums[name]) {
        warnings.push(t('{name} 在 {a} 和 {b} 里都有，用的是 {a} 的', { name, a: where.get(name)!, b: f.rel }))
        continue
      }
      enums[name] = list
      where.set(name, f.rel)
    }
  }
  if (!hit)
    throw new Error(
      t('「{glob}」对上的 {n} 个表格里都没有页签「{sheet}」', { glob: from.file, n: files.length, sheet: from.sheet }),
    )
  return { enums, warnings, files }
}
