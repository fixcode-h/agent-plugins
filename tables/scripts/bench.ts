/**
 * 表格页的性能基准：生成一批假表格（默认 5000 个文件、一张 1 万行 × 80 列的大 CSV、一本同样大的 xlsx），
 * 量列表、解析、检查、差异、xlsx 读写、跨表搜索的耗时，超过目标就以非 0 退出。跑法（插件目录 tables/ 下，面板模块从 ../.panel 取）：AGENT_PLUGIN_PANEL=../.panel AGENT_PLUGIN_DIR=. node --import ../scripts/lib/panel-register.mjs scripts/bench.ts（可加 --files 20000 --rows 50000）。临时文件写在 .tmp/ 下，跑完删掉。
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

// 保存会往数据目录写备份：指到临时目录，别碰本机的面板数据（要在 import 服务端模块之前设）
const dataDir = mkdtempSync(path.join(tmpdir(), 'bench-tables-data-'))
process.env.AGENT_PANEL_DATA = dataDir
const { TableSchema, TablesConfig } = await import('../shared/tables.ts')
const { checkSheet, columnInfos, columnOptions } = await import('../shared/table-struct.ts')
const { diffSheet } = await import('../shared/sheet-diff.ts')
const { listTables, parseTable } = await import('../server/tables/files.ts')
const { searchTables } = await import('../server/tables/search.ts')
const { saveTable } = await import('../server/tables/write.ts')
const { bigBook } = await import('../server/tables/xlsx-fixture.ts')
const { replaceTables } = await import('../server/tables/bulk-replace.ts')
const { TableReplaceBody } = await import('../shared/table-search.ts')

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? Number(process.argv[i + 1]) : def
}
const FILES = arg('files', 5000)
const ROWS = arg('rows', 10000)
const COLS = arg('cols', 80)

/** 目标（毫秒）：见 designs/表格功能-待办与性能设计.md 第四节 */
const BUDGET = {
  list: 1500,
  parse: 1500,
  check: 400,
  recheck: 30,
  diff: 1500,
  // 1 万行 × 80 列的 xlsx：80 万格，原来超过 20 万格的上限只能只读
  xlsxParse: 2500,
  xlsxSave: 4000,
  // 跨表搜索：第一次要把所有表解析一遍（冷），之后走缓存（热）
  searchCold: 3000,
  search: 800,
  searchField: 800,
  // 跨表替换：大表里一列 1 万格全换（预览要把保存前的检查都试一遍）
  replacePreview: 5000,
  replaceApply: 5000,
}

const dir = path.resolve('.tmp', `bench-tables-${process.pid}`)
const fails: string[] = []
const time = async <T>(name: keyof typeof BUDGET, f: () => T | Promise<T>) => {
  const t0 = performance.now()
  const out = await f()
  const ms = performance.now() - t0
  const ok = ms <= BUDGET[name]
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(14)} ${ms.toFixed(0).padStart(6)} ms（目标 ${BUDGET[name]}）`)
  if (!ok) fails.push(name)
  return out
}

try {
  // 很多小表：按 50 个一个目录分开
  for (let i = 0; i < FILES; i++) {
    const sub = path.join(dir, 'Excel', `G${Math.floor(i / 50)}`)
    if (i % 50 === 0) mkdirSync(sub, { recursive: true })
    writeFileSync(path.join(sub, `T${i}.csv`), 'ID,Name\nuint32,string\n1,a\n')
  }
  // 一张大表：两行表头（类型、字段名）+ 数据
  const head = [
    Array.from({ length: COLS }, (_, c) => (c % 3 ? 'string' : 'uint32')),
    Array.from({ length: COLS }, (_, c) => (c ? `F${c}` : 'ID')),
  ]
  const lines = [...head.map((r) => r.join(','))]
  for (let r = 0; r < ROWS; r++)
    lines.push(Array.from({ length: COLS }, (_, c) => (c % 3 ? `v${r}_${c}` : String(r + c))).join(','))
  writeFileSync(path.join(dir, 'Big.csv'), lines.join('\n'))

  const cfg = TablesConfig.parse({ dirs: ['Excel'] })
  const index = await time('list', () => listTables(dir, cfg, true))
  console.log(`  列出 ${index.files.length} 个文件`)
  const { sheets } = await time('parse', () => parseTable(path.join(dir, 'Big.csv')))
  const rows = sheets[0].rows
  const schema = TableSchema.parse({})
  const header = { start: 0, roles: ['type', 'name'] as ('type' | 'name')[] }
  const infos = columnInfos(schema, rows, header, 'Big.csv', 'Big', COLS)
  const { ctx } = columnOptions(schema, infos, () => undefined)
  const cache = new WeakMap<string[], { c: number; msg: string }[]>()
  await time('check', () => checkSheet(rows, 2, infos, 'ID', ctx, 2000, cache))
  // 改一格：只复制那一行，其余行用缓存
  const next = [...rows]
  next[500] = [...rows[500]]
  next[500][1] = 'changed'
  await time('recheck', () => checkSheet(next, 2, infos, 'ID', ctx, 2000, cache))
  // 差异：没有唯一主键时走 LCS / 贪心；中间删一行、改几格
  const b = rows.filter((_, i) => i !== 3000).map((r, i) => (i % 997 === 0 ? [...r.slice(0, -1), 'x'] : r))
  await time('diff', () => diffSheet({ rows, from: 2, names: head[1] }, { rows: b, from: 2, names: head[1] }, ''))

  // 大 xlsx：整份读进来（不截断、能改），改一格保存（原地改写 + 读回比对 + 备份）
  const big = path.join(dir, 'Excel', 'BigItem.xlsx')
  writeFileSync(big, bigBook(ROWS, COLS))
  console.log(`  BigItem.xlsx ${(statSync(big).size / 1e6).toFixed(1)} MB`)
  const book = await time('xlsxParse', () => parseTable(big))
  if (book.sheets[0].truncated || book.sheets[0].rows.length !== ROWS + 2) fails.push('xlsx 没有整份读进来')
  const mtime = statSync(big).mtime.toISOString()
  const saved = await time(
    'xlsxSave',
    () =>
    saveTable(dir, 'bench', cfg, { path: 'Excel/BigItem.xlsx', mtime, sheets: [{ name: 'Big', rows: [], cells: [{ r: 5000, c: 1, v: '改过' }] }], force: false }), // prettier-ignore
  )
  if (saved.readOnly || saved.sheets[0].rows[5000][1] !== '改过') fails.push('大 xlsx 保存后读回来不对')

  // 跨表搜索：所有小表 + 大 xlsx
  const all = (await listTables(dir, cfg, true)).files
  await time('searchCold', () => searchTables(dir, all, { q: 'v9999_79' }))
  const hit = await time('search', () => searchTables(dir, all, { q: 'v9999_79' }))
  if (hit.hits.length !== 1) fails.push(`搜索命中数不对：${hit.hits.length}`)
  const byField = await time('searchField', () => searchTables(dir, all, { q: 'ID:9000', whole: true }))
  if (!byField.hits.some((h) => h.path.endsWith('BigItem.xlsx'))) fails.push('「字段名:值」没找到大表里的行')

  // 跨表替换：F79 这一列每格都换（1 万格），先预览再写
  const rctx = { dir, projectId: 'bench', cfg, files: all, schema }
  const body = { q: 'F79:_79', replace: '_X' }
  const preview = await time('replacePreview', () => replaceTables(rctx, TableReplaceBody.parse(body), {}))
  const big1 = preview.files.find((f) => f.path.endsWith('BigItem.xlsx'))
  if (big1?.cells !== ROWS || big1.blocked) fails.push(`替换预览不对：${JSON.stringify(big1)?.slice(0, 200)}`)
  const files = Object.fromEntries(preview.files.map((f) => [f.path, f.mtime]))
  const done = await time('replaceApply', () =>
    replaceTables(rctx, TableReplaceBody.parse({ ...body, apply: true, files }), {}),
  )
  if (done.failed.length) fails.push(`替换失败：${done.failed[0].error}`)
} finally {
  rmSync(dir, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
}
if (fails.length) {
  console.error(`超过目标：${fails.join('、')}`)
  process.exit(1)
}
