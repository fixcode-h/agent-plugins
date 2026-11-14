/**
 * 枚举扫描的执行（规则和纯函数在 shared/table-enum-scan.ts，结果存取在 enum-scan-store.ts）：
 * - 手动：设置里「立即扫描」、枚举对话框「重新扫描」，按规则 id 扫
 * - 打开时（auto: 'open'）：进表格页、打开 / 保存了规则用到的文件时，页面请求一次；这里只 stat 源文件，
 *   修改时间和大小都和上次一样就不读，5000 张表的项目也只碰规则指到的那几个文件
 * - 试跑：设置里改规则时预览，不写结果
 * 同一个结构文件目录的扫描排队跑，不会两次扫描同时写结果文件。扫描出错照实返回，旧结果保留并记下错误。
 */
import { stat } from 'node:fs/promises'
import { t } from '../../shared/i18n.ts'
import {
  applyRename,
  diffScan,
  scanSheets,
  type EnumScan,
  type ScanResult,
  type ScanResults,
  type ScanRun,
} from '../../shared/table-enum-scan.ts'
import { sheetFieldNames } from '../../shared/table-struct.ts'
import type { TableSchema, TablesConfig } from '../../shared/tables.ts'
import { openTable, safeRel } from './files.ts'
import { readScanResults, writeScanResults } from './enum-scan-store.ts'

export interface ScanCtx {
  dir: string
  cfg: TablesConfig
  schemaAt: string
  schema: TableSchema
}

/** 源文件现在的修改时间和大小；不在了返回 null */
async function fileStamp(ctx: ScanCtx, file: string) {
  const { full, rel } = safeRel(ctx.dir, file, ctx.cfg)
  const st = await stat(full).catch(() => null)
  return st?.isFile() ? { rel, mtime: st.mtime.toISOString(), size: st.size } : null
}

/** 按一条规则扫一次（不写结果） */
export async function scanOnce(
  ctx: ScanCtx,
  rule: EnumScan,
  prev?: ScanResult,
): Promise<ScanRun & { result: ScanResult }> {
  const at = new Date().toISOString()
  const fail = (error: string): ScanRun & { result: ScanResult } => {
    // 失败时旧结果留着照用，只记下错误（页面标「过期」）
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
  try {
    const stamp = await fileStamp(ctx, rule.from.file)
    if (!stamp) return fail(t('找不到文件：{file}', { file: rule.from.file }))
    const doc = await openTable(ctx.dir, rule.from.file, ctx.cfg)
    if (!doc.sheets.length) return fail(doc.readOnly ?? t('这个文件里没有页签'))
    const name = stamp.rel.replace(/.*\//, '')
    const got = applyRename(
      scanSheets(
        rule.from,
        doc.sheets,
        (sheet) => {
          const h = sheetFieldNames(ctx.schema, doc.path, sheet)
          return { names: h.names, dataFrom: h.from }
        },
        name,
      ),
      rule.rename,
    )
    const result: ScanResult = {
      at,
      files: { [stamp.rel]: { mtime: stamp.mtime, size: stamp.size } },
      enums: got.enums,
      warnings: got.warnings.slice(0, 50),
    }
    return {
      id: rule.id,
      enums: got.enums,
      warnings: result.warnings,
      diff: diffScan(prev?.enums, got.enums),
      at,
      result,
    }
  } catch (e) {
    return fail((e as Error).message)
  }
}

/** 「打开时」的规则：源文件和上次扫的时候比，变了（或从没扫过、上次失败）才要扫 */
async function stale(ctx: ScanCtx, rule: EnumScan, prev: ScanResult | undefined) {
  if (!prev || prev.error) return true
  const stamp = await fileStamp(ctx, rule.from.file).catch(() => null)
  if (!stamp) return true
  const old = prev.files[stamp.rel]
  return !old || old.mtime !== stamp.mtime || old.size !== stamp.size
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

export interface ScanPick {
  /** 只扫这几条（手动）；不写是全部 */
  ids?: string[]
  /** 自动刷新：只看 auto 为 open 的规则，源文件没变的跳过 */
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
        if (rule.auto !== 'open') continue
        if (pick.file && !sameFile(rule.from.file, pick.file)) continue
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
