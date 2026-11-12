/**
 * 跨表批量替换：预览不写文件、列出会被拒绝的文件；只写勾选的、预览之后没被改过的文件；
 * 只改数据行（表头不动）；「字段名:值」只改那一列；保存前检查设成「不让保存」时拦下不合规的文件。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.AGENT_PANEL_DATA = mkdtempSync(path.join(tmpdir(), 'agent-panel-tables-replace-data-'))
const { TableSchema, TablesConfig } = await import('../../shared/tables.ts')
const { listTables } = await import('./files.ts')
const { replaceTables } = await import('./bulk-replace.ts')
const { TableReplaceBody } = await import('../../shared/table-search.ts')
const { gameBook } = await import('./xlsx-fixture.ts')

const cfg = TablesConfig.parse({ dirs: ['Config'] })

async function setup(schema = TableSchema.parse({ style: { header: { start: 0, rows: [{ kind: 'name' }] } } })) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-panel-tables-replace-'))
  mkdirSync(path.join(dir, 'Config'))
  writeFileSync(path.join(dir, 'Config', 'Item.csv'), 'ID,Name,Drop\n1001,木剑,1001;1002\n1002,铁剑,1001\n')
  writeFileSync(path.join(dir, 'Config', 'Shop.csv'), 'ID,Item\n1,1001\n2,10010\n')
  const { files } = await listTables(dir, cfg, true)
  const ctx = { dir, projectId: 'p', cfg, files, schema }
  const run = (b: Partial<import('../../shared/table-search.ts').TableReplaceBody>) =>
    replaceTables(ctx, TableReplaceBody.parse({ q: '', replace: '', ...b }), {})
  const read = (f: string) => readFileSync(path.join(dir, 'Config', f), 'utf8')
  return { dir, run, read }
}

test('预览：每个文件改几格、前几处改前改后，不写文件；表头不替换', async () => {
  const { run, read } = await setup()
  const before = read('Item.csv')
  const r = await run({ q: 'ID', replace: 'X' })
  assert.deepEqual(r.files, [])
  const p = await run({ q: '1001', whole: true, replace: '2001' })
  assert.equal(r.applied, false)
  assert.deepEqual(
    p.files.map((f) => [f.path, f.cells]),
    [
      ['Config/Item.csv', 3],
      ['Config/Shop.csv', 1],
    ],
  )
  assert.deepEqual(p.files[0].samples[0], { sheet: 'Item', row: 1, col: 0, field: 'ID', old: '1001', next: '2001' })
  assert.equal(read('Item.csv'), before)
})

test('写入：只写勾选的文件，数组列只换那一项；「字段名:值」只改那一列', async () => {
  const { run, read } = await setup()
  const p = await run({ q: 'Drop:1001', whole: true, replace: '2001' })
  assert.equal(p.field, 'Drop')
  assert.deepEqual(
    p.files.map((f) => f.path),
    ['Config/Item.csv'],
  )
  const files = Object.fromEntries(p.files.map((f) => [f.path, f.mtime]))
  const w = await run({ q: 'Drop:1001', whole: true, replace: '2001', apply: true, files })
  assert.deepEqual(w.failed, [])
  assert.equal(read('Item.csv'), 'ID,Name,Drop\n1001,木剑,2001;1002\n1002,铁剑,2001\n')
  assert.equal(read('Shop.csv'), 'ID,Item\n1,1001\n2,10010\n')
})

test('预览之后文件被改过：这个文件不写，说明原因；没有这个字段时按整串找', async () => {
  const { dir, run, read } = await setup()
  const p = await run({ q: '铁剑', replace: '钢剑' })
  const file = path.join(dir, 'Config', 'Item.csv')
  const later = new Date(statSync(file).mtimeMs + 5000)
  utimesSync(file, later, later)
  const w = await run({ q: '铁剑', replace: '钢剑', apply: true, files: { 'Config/Item.csv': p.files[0].mtime } })
  assert.match(w.failed[0].error, /预览之后文件被改过/)
  assert.match(read('Item.csv'), /铁剑/)
  const missing = await run({ q: 'Nope:铁剑', replace: 'x' })
  assert.equal(missing.fieldMissing, 'Nope')
  assert.deepEqual(missing.files, [])
})

test('xlsx：公式格在预览里就标出拒绝原因；保存前检查「不让保存」时拦下不合规的替换', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-panel-tables-replace-x-'))
  mkdirSync(path.join(dir, 'Config'))
  writeFileSync(path.join(dir, 'Config', 'Book.xlsx'), gameBook({ formulaSheet1: true }))
  const { files } = await listTables(dir, cfg, true)
  const schema = TableSchema.parse({ style: { header: { start: 2, rows: [{ kind: 'name' }] } } })
  const ctx = { dir, projectId: 'p', cfg, files, schema }
  // 道具表 C6 是公式（=A6*2，存的结果是 6）
  const p = await replaceTables(ctx, TableReplaceBody.parse({ q: '6', whole: true, replace: '7' }), {})
  assert.match(p.files[0].blocked ?? '', /公式/)
  const strict = TableSchema.parse({
    style: { header: { start: 2, rows: [{ kind: 'name' }] }, saveCheck: 'block' },
    enums: { Weapon: { values: [{ name: 'Sword' }] } },
    columns: { 'Config/Book.xlsx#道具#Kind': { enum: 'Weapon' } },
  })
  const blocked = await replaceTables(
    { ...ctx, schema: strict },
    TableReplaceBody.parse({ q: 'Kind:Sword', replace: 'Bow' }),
    {},
  )
  assert.match(blocked.files[0].blocked ?? '', /不符合表格结构/)
})

test('替换后主键和后面已有的行重复：预览里算出不合规（重复记在没改的那一行上也算）', async () => {
  const { run } = await setup(
    TableSchema.parse({ style: { header: { start: 0, rows: [{ kind: 'name' }] }, key: 'ID' } }),
  )
  const p = await run({ q: 'ID:1001', whole: true, replace: '1002' })
  assert.equal(p.files[0].path, 'Config/Item.csv')
  assert.equal(p.files[0].problems, 1)
})
