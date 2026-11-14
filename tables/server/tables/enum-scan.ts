/**
 * 枚举扫描的执行（规则和纯函数在 shared/table-enum-scan*.ts，结果存取在 enum-scan-store.ts）：
 * - 手动：设置里「立即扫描」、枚举对话框「重新扫描」，按规则 id 扫
 * - 打开时（auto: 'open'）：进表格页、打开 / 保存了规则用到的文件时，页面请求一次；这里只 stat 源文件，
 *   修改时间和大小都和上次一样就不读，5000 张表的项目也只碰规则指到的那几个文件
 * - 盯着改动（auto: 'watch'）：enum-scan-watch.ts 在文件变了时调这里，再推给页面
 * - 试跑：设置里改规则、AI 总结规则时预览，不写结果
 * 代码类规则按文件记缓存（修改时间 + 大小没变的不重读）。同一个结构文件目录的扫描排队跑，不会两次扫描同时写结果文件。
 * 扫描出错照实返回，旧结果保留并记下错误。
 */
import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { t } from '../../shared/i18n.ts'
import {
  applyRename,
  diffScan,
  isSheetFrom,
  scanSheets,
  type CodeFrom,
  type EnumScan,
  type ScanFrom,
  type ScanResult,
  type ScanResults,
  type ScanRun,
  type SheetFrom,
  type SheetScan,
} from '../../shared/table-enum-scan.ts'
import { scanCode, type CodeScan } from '../../shared/table-enum-scan-code.ts'
import { sheetFieldNames } from '../../shared/table-struct.ts'
import type { TableSchema, TablesConfig } from '../../shared/tables.ts'
import { openTable, safeRel, tableFull } from './files.ts'
import { readScanResults, writeScanResults } from './enum-scan-store.ts'
import { findSources, type SrcFile } from './enum-scan-files.ts'
import { runShell } from '../merge-build.ts'
import { currentShell } from '../shells.ts'

export interface ScanCtx {
  dir: string
  cfg: TablesConfig
  schemaAt: string
  schema: TableSchema
}

type Stamps = ScanResult['files']
type Got = SheetScan & { files: Stamps }

/** 源文件现在的修改时间和大小；不在了返回 null */
async function fileStamp(ctx: ScanCtx, file: string) {
  const { full, rel } = safeRel(ctx.dir, file, ctx.cfg)
  const st = await stat(full).catch(() => null)
  return st?.isFile() ? { rel, mtime: st.mtime.toISOString(), size: st.size } : null
}

/** 表格里的写法：读那一个表格文件 */
async function scanSheetRule(ctx: ScanCtx, from: SheetFrom): Promise<Got> {
  const stamp = await fileStamp(ctx, from.file)
  if (!stamp) throw new Error(t('找不到文件：{file}', { file: from.file }))
  const doc = await openTable(ctx.dir, from.file, ctx.cfg)
  if (!doc.sheets.length) throw new Error(doc.readOnly ?? t('这个文件里没有页签'))
  const got = scanSheets(
    from,
    doc.sheets,
    (sheet) => {
      const h = sheetFieldNames(ctx.schema, doc.path, sheet)
      return { names: h.names, dataFrom: h.from }
    },
    stamp.rel.replace(/.*\//, ''),
  )
  return { ...got, files: { [stamp.rel]: { mtime: stamp.mtime, size: stamp.size } } }
}

/** 代码文件的扫描结果按（文件, 规则写法）缓存：修改时间和大小没变就不重读 */
const codeCache = new Map<string, { stamp: string; got: CodeScan }>()
const CACHE_MAX = 20000

/** 代码里的写法：按通配找文件，逐个扫再合并 */
async function scanCodeRule(ctx: ScanCtx, from: CodeFrom): Promise<Got> {
  const files = await findSources(ctx.dir, from.files, from.exclude)
  if (!files.length) throw new Error(t('「{glob}」没对上任何文件', { glob: from.files }))
  const key = JSON.stringify(from)
  const enums: Got['enums'] = {}
  const warnings: string[] = []
  const where = new Map<string, string>()
  for (const f of files) {
    const ck = `${f.full}\u0000${key}`
    const stamp = `${f.mtime}\u0000${f.size}`
    let got = codeCache.get(ck)?.stamp === stamp ? codeCache.get(ck)!.got : undefined
    if (!got) {
      const text = await readFile(f.full, 'utf8')
      got = scanCode(text, from, f.rel)
      if (codeCache.size > CACHE_MAX) codeCache.clear()
      codeCache.set(ck, { stamp, got })
    }
    warnings.push(...got.warnings)
    for (const [name, list] of Object.entries(got.enums)) {
      if (enums[name]) {
        warnings.push(t('{name} 在 {a} 和 {b} 里都有，用的是 {a} 的', { name, a: where.get(name)!, b: f.rel }))
        continue
      }
      enums[name] = list
      where.set(name, f.rel)
    }
  }
  return { enums, warnings, files: stampsOf(files) }
}

const stampsOf = (files: SrcFile[]): Stamps =>
  Object.fromEntries(files.map((f) => [f.rel, { mtime: f.mtime, size: f.size }]))

/**
 * 自定义命令：在项目目录（或 cwd）跑，标准输出里取 JSON：{"enums":{"EFoo":[{"name":"A","value":"1"}]}}，
 * 也认直接给 {"EFoo":[…]} 或成员只写名字的 {"EFoo":["A","B"]}。退出码不是 0、超时、输出不是这个格式都算失败
 */
async function scanCommand(ctx: ScanCtx, from: Extract<ScanFrom, { kind: 'command' }>): Promise<Got> {
  if (!from.command.trim()) throw new Error(t('还没填命令'))
  const cwd = from.cwd ? tableFull(ctx.dir, from.cwd) : ctx.dir
  const lines: string[] = []
  const err: string[] = []
  const r = await runShell(from.command, cwd, {
    timeoutMs: from.timeoutSec * 1000,
    shell: (await currentShell()) ?? undefined,
    onLine: (l) => lines.length < 200_000 && lines.push(l),
    onStderr: (s) => err.length < 50 && err.push(s),
  })
  if (r.spawnError) throw new Error(t('命令没能运行：{error}', { error: r.spawnError }))
  if (r.killed) throw new Error(t('命令超过 {n} 秒没结束，停掉了', { n: from.timeoutSec }))
  if (r.code !== 0)
    throw new Error(t('命令退出码 {code}：{err}', { code: String(r.code), err: err.join('').trim().slice(0, 400) }))
  const out = lines.join('\n')
  const a = out.indexOf('{')
  const b = out.lastIndexOf('}')
  let raw: unknown
  try {
    raw = a >= 0 && b > a ? JSON.parse(out.slice(a, b + 1)) : undefined
  } catch {
    raw = undefined
  }
  const obj = (raw && typeof raw === 'object' && 'enums' in raw ? (raw as { enums: unknown }).enums : raw) as
    Record<string, unknown> | undefined
  if (!obj || typeof obj !== 'object') throw new Error(t('命令的输出里没有找到 {"enums": {...}} 这样的 JSON'))
  const enums: Got['enums'] = {}
  const warnings: string[] = []
  for (const [name, list] of Object.entries(obj)) {
    if (!Array.isArray(list)) {
      warnings.push(t('{name} 的成员不是数组，跳过了', { name }))
      continue
    }
    enums[name] = list.slice(0, 5000).flatMap((m) => {
      if (typeof m === 'string') return m.trim() ? [{ name: m.trim() }] : []
      if (!m || typeof m !== 'object' || typeof (m as { name?: unknown }).name !== 'string') return []
      const x = m as { name: string; value?: unknown; desc?: unknown }
      const value = x.value === undefined || x.value === null ? undefined : String(x.value).slice(0, 60)
      const desc = typeof x.desc === 'string' && x.desc.trim() ? x.desc.trim().slice(0, 500) : undefined
      return x.name.trim() ? [{ name: x.name.trim(), ...(value ? { value } : {}), ...(desc ? { desc } : {}) }] : []
    })
  }
  // 命令自己不报读了哪些文件：规则写了 files 时记下它们，「打开时 / 盯着改动」按它们判断要不要重跑
  const files = from.files.trim() ? await findSources(ctx.dir, from.files, from.exclude).catch(() => []) : []
  return { enums, warnings, files: stampsOf(files) }
}

/** 按一条规则扫一次（不写结果） */
export async function scanOnce(
  ctx: ScanCtx,
  rule: EnumScan,
  prev?: ScanResult,
): Promise<ScanRun & { result: ScanResult }> {
  const at = new Date().toISOString()
  try {
    const from = rule.from
    const raw = isSheetFrom(from)
      ? await scanSheetRule(ctx, from)
      : from.kind === 'command'
        ? await scanCommand(ctx, from)
        : await scanCodeRule(ctx, from)
    const got = applyRename(raw, rule.rename)
    const result: ScanResult = { at, files: raw.files, enums: got.enums, warnings: got.warnings.slice(0, 50) }
    return {
      id: rule.id,
      enums: got.enums,
      warnings: result.warnings,
      diff: diffScan(prev?.enums, got.enums),
      at,
      result,
    }
  } catch (e) {
    // 失败时旧结果留着照用，只记下错误（页面标「过期」）
    const error = (e as Error).message
    const result: ScanResult = { ...(prev ?? { at, files: {}, enums: {}, warnings: [] }), error }
    return {
      id: rule.id,
      enums: result.enums,
      warnings: result.warnings,
      error,
      diff: diffScan(prev?.enums, result.enums),
      at,
      result,
    }
  }
}

/** 自动扫的规则：源文件和上次扫的时候比，变了（或从没扫过、上次失败）才要扫 */
async function stale(ctx: ScanCtx, rule: EnumScan, prev: ScanResult | undefined) {
  if (!prev || prev.error) return true
  const from = rule.from
  if (isSheetFrom(from)) {
    const stamp = await fileStamp(ctx, from.file).catch(() => null)
    if (!stamp) return true
    const old = prev.files[stamp.rel]
    return !old || old.mtime !== stamp.mtime || old.size !== stamp.size
  }
  // 命令没写 files：没法知道源头变没变，自动时不跑（只能手动）
  if (from.kind === 'command' && !from.files.trim()) return false
  // 代码类只 stat：文件多了、少了、改了都算变了
  const now = await findSources(ctx.dir, from.files, from.exclude).catch(() => null)
  if (!now) return true
  const keys = Object.keys(prev.files)
  if (keys.length !== now.length) return true
  return now.some((f) => prev.files[f.rel]?.mtime !== f.mtime || prev.files[f.rel]?.size !== f.size)
}

/** 同一个结构文件目录的扫描排队跑 */
const queues = new Map<string, Promise<unknown>>()
function queued<T>(key: string, f: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(f)
  queues.set(key, run)
  void run.finally(() => queues.get(key) === run && queues.delete(key)).catch(() => undefined)
  return run
}

const sameFile = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

/** 自动扫时这条规则用不用到这个文件（表格类比文件名；代码类看是不是上次扫过的文件之一） */
function uses(rule: EnumScan, file: string, prev: ScanResult | undefined) {
  if (isSheetFrom(rule.from)) return sameFile(rule.from.file, file)
  return Object.keys(prev?.files ?? {}).some((f) => sameFile(f, file) || sameFile(path.basename(f), file))
}

export interface ScanPick {
  /** 只扫这几条（手动）；不写是全部 */
  ids?: string[]
  /** 自动刷新：只看 auto 为 open / watch 的规则，源文件没变的跳过 */
  auto?: boolean
  /** 自动刷新时只看用到这个文件的规则（打开 / 保存了某个文件） */
  file?: string
}

/**
 * 按挑出来的规则扫描并写结果；返回扫了的那几条（自动刷新时没变的不在里面）。
 * 规则删了的旧结果顺便清掉
 */
export function runScans(ctx: ScanCtx, pick: ScanPick): Promise<ScanRun[]> {
  return queued(ctx.schemaAt, async () => {
    const results: ScanResults = await readScanResults(ctx.schemaAt)
    const runs: ScanRun[] = []
    let dirty = false
    for (const rule of ctx.schema.scans) {
      if (pick.ids && !pick.ids.includes(rule.id)) continue
      if (pick.auto) {
        if (rule.auto === 'off') continue
        if (pick.file && !uses(rule, pick.file, results[rule.id])) continue
        if (!(await stale(ctx, rule, results[rule.id]))) continue
      }
      const { result, ...run } = await scanOnce(ctx, rule, results[rule.id])
      results[rule.id] = result
      dirty = true
      runs.push(run)
    }
    const ids = new Set(ctx.schema.scans.map((s) => s.id))
    for (const k of Object.keys(results))
      if (!ids.has(k)) {
        delete results[k]
        dirty = true
      }
    if (dirty) await writeScanResults(ctx.schemaAt, results)
    return runs
  })
}
