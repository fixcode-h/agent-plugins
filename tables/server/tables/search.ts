/**
 * 跨表搜索：在全部表格文件里按内容找，支持「字段名:值」只在叫这个名字的列里找，区分大小写 / 整格 / 正则三个开关。
 * 匹配规则在 shared/table-search.ts（跨表替换、Agent 的 table.search 用同一份）。解析走 files.ts 的缓存，第一次全量解析、之后只重读变过的文件。
 */
import type { SheetData } from '../../shared/files.ts'
import type { TableFile, TableHit, TableSchema, TableSearch } from '../../shared/tables.ts'
import { sheetFieldNames } from '../../shared/table-struct.ts'
import {
  cellMatcher,
  hitSnippet,
  parseSearchQuery,
  sameField,
  type CellMatcher,
  type ParsedQuery,
  type TableSearchOpts,
} from '../../shared/table-search.ts'
import { parseTable, tableFull } from './files.ts'
import { HttpError } from './http-error.ts'

/** 内容搜索默认最多给这么多处命中 */
export const MAX_HITS = 500

/**
 * 一个个解析表格文件交给 fn（老 .xls 跳过、解析失败的交给 onFail）。fn 返回 false 时停下。
 * 页面上又输了新的字（请求被取消）就不接着读；每读几个文件让一下，别的请求不用等整轮读完
 */
export async function eachTable(
  dir: string,
  files: TableFile[],
  fn: (f: TableFile, sheets: SheetData[]) => boolean | void | Promise<boolean | void>,
  signal?: AbortSignal,
  onFail?: (f: TableFile, err: Error) => void,
) {
  let n = 0
  for (const f of files) {
    if (f.kind === 'xls') continue
    if (signal?.aborted) break
    if (++n % 20 === 0) await new Promise((r) => setImmediate(r))
    let sheets: SheetData[]
    try {
      sheets = (await parseTable(tableFull(dir, f.path))).sheets
    } catch (e) {
      onFail?.(f, e as Error)
      continue
    }
    if ((await fn(f, sheets)) === false) break
  }
}

/**
 * 一张表里要找哪些格子：写了字段名时只找数据行里那一列（这张表没有这个字段就是 null），
 * 没写时全表都找（包括表头，方便找字段名本身）
 */
export function sheetScope(
  schema: TableSchema | undefined,
  file: string,
  sheet: SheetData,
  field: string | undefined,
): SheetScope | null {
  const h = sheetFieldNames(schema, file, sheet)
  const key = schema?.style.key || 'ID'
  const keyCol = h.names.findIndex((n) => n === key)
  if (!field) return { start: 0, from: h.from, col: -1, names: h.names, keyCol }
  const col = h.names.findIndex((n) => n && sameField(n, field))
  return col < 0 ? null : { start: h.from, from: h.from, col, names: h.names, keyCol }
}

export interface SheetScope {
  /** 从第几行开始找 */
  start: number
  /** 数据从第几行开始（之前是表头） */
  from: number
  /** 只找这一列；-1 是每列都找 */
  col: number
  /** 字段名行 */
  names: string[]
  /** 主键列（项目设置的主键字段名）；没有是 -1 */
  keyCol: number
}

/** 按开关编匹配器：写错的正则是用户的输入问题，给 400 */
export function matcherOf(pq: ParsedQuery, opts: TableSearchOpts, schema?: TableSchema): CellMatcher {
  try {
    return cellMatcher(pq.text, opts, schema?.style.listSep || ';')
  } catch (e) {
    throw new HttpError((e as Error).message)
  }
}

/** 在全部表格文件里按内容找，命中按文件顺序 */
export async function searchTables(
  dir: string,
  files: TableFile[],
  opts: TableSearchOpts,
  signal?: AbortSignal,
  schema?: TableSchema,
  limit = MAX_HITS,
): Promise<TableSearch> {
  const pq = parseSearchQuery(opts.q)
  if (!pq.text) return { hits: [], files: 0 }
  const out = await scan(dir, files, pq, opts, signal, schema, limit)
  // 写了「字段名:」但没有哪张表有这一列：多半是值本身带冒号（http://……），按整串再找一遍
  if (pq.field && !out.fieldSeen) {
    const plain = await scan(dir, files, { text: opts.q.trim() }, opts, signal, schema, limit)
    return { ...plain.result, fieldMissing: pq.field }
  }
  return { ...out.result, ...(pq.field ? { field: pq.field } : {}) }
}

async function scan(
  dir: string,
  files: TableFile[],
  pq: ParsedQuery,
  opts: TableSearchOpts,
  signal: AbortSignal | undefined,
  schema: TableSchema | undefined,
  limit: number,
): Promise<{ result: TableSearch; fieldSeen: boolean }> {
  const m = matcherOf(pq, opts, schema)
  const hits: TableHit[] = []
  let searched = 0
  let fieldSeen = false
  let truncated = false
  await eachTable(
    dir,
    files,
    (f, sheets) => {
      searched++
      for (const s of sheets) {
        // 不限字段时字段名只在这张表有命中时才算一次（几千张表大多没命中）
        let scope = pq.field ? sheetScope(schema, f.path, s, pq.field) : undefined
        if (scope === null) continue
        if (scope) fieldSeen = true
        for (let r = scope?.start ?? 0; r < s.rows.length; r++) {
          const row = s.rows[r]
          const c0 = scope && scope.col >= 0 ? scope.col : 0
          const c1 = scope && scope.col >= 0 ? scope.col + 1 : row.length
          for (let c = c0; c < c1; c++) {
            const v = row[c]
            const at = v ? m.find(v) : null
            if (!at) continue
            scope ??= sheetScope(schema, f.path, s, undefined)!
            const data = r >= scope.from
            const field = data ? scope.names[c] : undefined
            const key = data && scope.keyCol >= 0 ? row[scope.keyCol] : undefined
            const snip = hitSnippet(v, at)
            hits.push({
              path: f.path,
              sheet: s.name,
              row: r,
              col: c,
              text: snip.text,
              at: snip.at,
              ...(field ? { field } : {}),
              ...(key ? { key } : {}),
            })
            if (hits.length >= limit) {
              truncated = true
              return false
            }
          }
        }
      }
    },
    signal,
  )
  return { result: { hits, files: searched, ...(truncated ? { truncated } : {}) }, fieldSeen }
}
