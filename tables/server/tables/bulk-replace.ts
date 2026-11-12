/**
 * 跨表批量替换：在跨表搜索的结果上「全部替换」。先预览（每个文件改几格、前几处改前改后、会不会被拒绝），
 * 用户勾选后逐个文件走原地保存（只改格子、备份、P4 先签出），失败的文件列出原因，不影响别的文件。
 *
 * 哪些情况拒绝（整个请求）：项目设成只读；查询为空或正则写错。
 * 哪些情况拒绝（单个文件，预览时就标出来，写的时候也再查一次）：
 * - 老 .xls / .et：不在列表里（只能用表格软件改）
 * - 表格太大只读了一部分（truncated）：没读到的部分没法比对
 * - 正被 Excel / WPS 打开（有锁文件）
 * - 预览之后文件被外面改过（修改时间对不上）：要重新预览，免得改了用户没看过的东西
 * - 原地改写做不了：要改的格子是公式格、表格写法少见（带命名空间前缀、行里有不认识的内容）
 * - 写完读回来和预期不一样（写入器的保险，这时原文件不动）
 * - 项目的「保存前检查」设成「不让保存」时，替换后不符合表格结构（枚举、引用、类型……）的文件
 * 只改数据行：表头（字段名、类型、注释这些行）不替换，免得把字段名换掉、整列对不上。
 */
import { stat } from 'node:fs/promises'
import { t } from '../../shared/i18n.ts'
import type { SheetData } from '../../shared/files.ts'
import type { TableFile, TableSchema, TablesConfig } from '../../shared/tables.ts'
import type { CellSet, SheetEdit } from '../../shared/table-edit.ts'
import { checkTouched, workbookNeeds } from '../../shared/table-struct.ts'
import {
  parseSearchQuery,
  type CellMatcher,
  type ParsedQuery,
  type ReplaceFile,
  type ReplaceResult,
  type TableReplaceBody,
} from '../../shared/table-search.ts'
import { parseTable, tableFull } from './files.ts'
import { eachTable, matcherOf, sheetScope } from './search.ts'
import { prepareSave, saveTable, type SaveDeps } from './write.ts'
import { HttpError } from './http-error.ts'

/** 一个文件最多替换这么多格（和保存接口的上限一致） */
const MAX_CELLS = 200_000
/** 预览里每个文件列出前几处改前改后 */
const SAMPLES = 5

/** 一个文件里要替换的格子：只算数据行，按工作表分开 */
function fileEdits(
  schema: TableSchema,
  path: string,
  sheets: SheetData[],
  pq: ParsedQuery,
  m: CellMatcher,
  to: string,
  seen: { field: boolean },
) {
  const edits: (SheetEdit & { sheet: SheetData })[] = []
  const samples: ReplaceFile['samples'] = []
  let total = 0
  for (const s of sheets) {
    const scope = sheetScope(schema, path, s, pq.field)
    if (!scope) continue
    if (pq.field) seen.field = true
    const cells: CellSet[] = []
    for (let r = scope.from; r < s.rows.length && total < MAX_CELLS; r++) {
      const row = s.rows[r]
      const c0 = scope.col >= 0 ? scope.col : 0
      const c1 = scope.col >= 0 ? scope.col + 1 : row.length
      for (let c = c0; c < c1 && total < MAX_CELLS; c++) {
        const old = row[c]
        if (!old || !m.find(old)) continue
        const next = m.replace(old, to)
        if (next === old) continue
        cells.push({ r, c, v: next })
        total++
        if (samples.length < SAMPLES)
          samples.push({
            sheet: s.name,
            row: r,
            col: c,
            ...(scope.names[c] ? { field: scope.names[c] } : {}),
            old,
            next,
          })
      }
    }
    if (cells.length) edits.push({ name: s.name, rows: [], cells, sheet: s })
  }
  return { edits, samples, total }
}

/** 替换后按表格结构查改到的格子：返回不合规的处数 */
async function problemsAfter(
  dir: string,
  schema: TableSchema,
  path: string,
  sheets: SheetData[],
  edits: { sheet: SheetData; cells: CellSet[] }[],
) {
  const after = new Map(
    edits.map((e) => {
      const rows = e.sheet.rows.map((r) => r)
      for (const x of e.cells) rows[x.r] = Object.assign([...(rows[x.r] ?? [])], { [x.c]: x.v })
      return [e.sheet.name, { name: e.sheet.name, rows }]
    }),
  )
  const book = sheets.map((s) => after.get(s.name) ?? s)
  const ext = new Map<string, SheetData[] | undefined>()
  for (const f of workbookNeeds(schema, path, book))
    ext.set(f, await parseTable(tableFull(dir, f)).then((d) => d.sheets, () => undefined)) // prettier-ignore
  let n = 0
  for (const e of edits)
    n += checkTouched(schema, path, after.get(e.sheet.name)!, e.cells, (f) => (f === path ? book : ext.get(f))).length
  return n
}

export async function replaceTables(
  ctx: { dir: string; projectId: string; cfg: TablesConfig; files: TableFile[]; schema: TableSchema },
  body: TableReplaceBody,
  deps: SaveDeps,
  signal?: AbortSignal,
): Promise<ReplaceResult> {
  if (ctx.cfg.readOnly) throw new HttpError(t('项目设置里把表格设成了只读'), 409)
  let pq = parseSearchQuery(body.q)
  if (!pq.text) throw new HttpError(t('没有要找的内容'))
  const pick = body.apply ? (body.files ?? {}) : null
  if (pick && !Object.keys(pick).length) throw new HttpError(t('没有勾选要替换的文件'))
  const files = pick ? ctx.files.filter((f) => f.path in pick) : ctx.files
  let out = await run(ctx, files, pq, body, pick, deps, signal)
  // 和搜索一样：没有哪张表有这个字段时按整串找（预览和写入走同一条路，写入的就是预览看到的）
  if (pq.field && !out.seen) {
    const field = pq.field
    pq = { text: body.q.trim() }
    out = await run(ctx, files, pq, body, pick, deps, signal)
    return { ...out.result, fieldMissing: field }
  }
  return { ...out.result, ...(pq.field ? { field: pq.field } : {}) }
}

async function run(
  ctx: { dir: string; projectId: string; cfg: TablesConfig; schema: TableSchema },
  files: TableFile[],
  pq: ParsedQuery,
  body: TableReplaceBody,
  pick: Record<string, string> | null,
  deps: SaveDeps,
  signal?: AbortSignal,
): Promise<{ result: ReplaceResult; seen: boolean }> {
  const m = matcherOf(pq, body, ctx.schema)
  const result: ReplaceResult = { files: [], failed: [], applied: !!pick }
  const seen = { field: false }
  const block = ctx.schema.style.saveCheck === 'block'
  const done = new Set<string>()
  await eachTable(
    ctx.dir,
    files,
    async (f, sheets) => {
      done.add(f.path)
      const { edits, samples, total } = fileEdits(ctx.schema, f.path, sheets, pq, m, body.replace, seen)
      if (!edits.length) return
      const full = tableFull(ctx.dir, f.path)
      const mtime = (await stat(full)).mtime.toISOString()
      const save = { path: f.path, mtime, sheets: edits.map(({ name, rows, cells }) => ({ name, rows, cells })) }
      const item: ReplaceFile = { path: f.path, mtime, cells: total, samples }
      const problems = ctx.schema.style.saveCheck === 'off' ? 0 : await problemsAfter(ctx.dir, ctx.schema, f.path, sheets, edits) // prettier-ignore
      if (problems) item.problems = problems
      const refuse = (why: string) => {
        if (pick) result.failed.push({ path: f.path, error: why })
        else result.files.push({ ...item, blocked: why })
      }
      if (block && problems)
        return refuse(t('替换后有 {n} 处不符合表格结构（项目设成了不合规不让保存）', { n: problems }))
      if (!pick) {
        // 预览：把保存前的检查都做一遍（不写），会被拒绝的提前标出来
        try {
          await prepareSave(ctx.dir, ctx.cfg, save)
          result.files.push(item)
        } catch (e) {
          refuse((e as Error).message)
        }
        return
      }
      if (pick[f.path] !== mtime) return refuse(t('预览之后文件被改过了，重新预览再替换'))
      try {
        await saveTable(ctx.dir, ctx.projectId, ctx.cfg, save, deps)
        result.files.push(item)
      } catch (e) {
        refuse((e as Error).message)
      }
    },
    signal,
    (f, e) => {
      done.add(f.path)
      if (pick) result.failed.push({ path: f.path, error: e.message })
    },
  )
  // 勾了但这次没读到的文件：被删了、挪走了，或者被排除出表格目录了
  if (pick && !signal?.aborted)
    for (const p of Object.keys(pick))
      if (!done.has(p)) result.failed.push({ path: p, error: t('文件不在表格目录里了，可能已删除或挪走') })
  return { result, seen: seen.field }
}
