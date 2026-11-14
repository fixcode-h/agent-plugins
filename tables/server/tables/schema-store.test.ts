/** 表格结构文件：拆成 3 个文件存、读回来一样、没变的不重写、空的部分不建文件、坏文件当没有 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TableSchema } from '../../shared/tables.ts'
import { readSchema, writeSchema } from './schema-store.ts'

test('写进去再读出来一样；没变的部分不重写，空的部分不建文件', async () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'agent-panel-schema-')), 'tables')
  const s = TableSchema.parse({
    style: { header: { start: 0, rows: [{ kind: 'type', values: '@types' }, { kind: 'name' }, { kind: 'comment' }] } },
    enums: { MountType: { values: [{ name: 'FloorMirror', value: '1' }] } },
    analyzedAt: '2026-11-10T00:00:00.000Z',
  })
  await writeSchema(dir, s)
  assert.deepEqual(await readSchema(dir), s)
  assert.equal(existsSync(path.join(dir, 'columns.json')), false)
  assert.match(readFileSync(path.join(dir, 'style.json'), 'utf8'), /"analyzedAt"/)
  const before = statSync(path.join(dir, 'enums.json')).mtimeMs
  await new Promise((r) => setTimeout(r, 20))
  await writeSchema(dir, { ...s, style: { ...s.style, key: 'Id' } })
  assert.equal(statSync(path.join(dir, 'enums.json')).mtimeMs, before)
  assert.match(readFileSync(path.join(dir, 'style.json'), 'utf8'), /"Id"/)
})

test('旧格式（几套表头、按种类的取值、单表覆盖 files.json）读出来是新格式，保存后 files.json 删掉', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-panel-schema-'))
  writeFileSync(
    path.join(dir, 'style.json'),
    JSON.stringify({
      header: { start: 0, roles: ['type', 'name'] },
      headers: [
        { start: 0, roles: ['type', 'name'] },
        { start: 1, roles: ['name', 'comment'], labels: ['', '说明'] },
      ],
      roleEnums: { type: '@types' },
      exceptions: [{ glob: 'Enum/*.xlsx', header: { start: 0, roles: ['name'] } }],
    }),
  )
  writeFileSync(path.join(dir, 'files.json'), JSON.stringify({ 'Cfg/A#1.xlsx#Sheet#2': { start: 2, roles: ['name'] } }))
  const s = await readSchema(dir)
  assert.deepEqual(s.style.header, { start: 0, rows: [{ kind: 'type', values: '@types' }, { kind: 'name' }] })
  assert.deepEqual(s.style.exceptions, [
    { glob: 'Cfg/A#1.xlsx', sheet: 'Sheet#2', header: { start: 2, rows: [{ kind: 'name' }] } },
    { glob: 'Enum/*.xlsx', header: { start: 0, rows: [{ kind: 'name' }] } },
    { glob: '', header: { start: 1, rows: [{ kind: 'name' }, { kind: 'comment', label: '说明' }] } },
  ])
  await writeSchema(dir, s)
  assert.equal(existsSync(path.join(dir, 'files.json')), false)
  assert.deepEqual(await readSchema(dir), s)
  assert.doesNotMatch(readFileSync(path.join(dir, 'style.json'), 'utf8'), /roles|roleEnums|headers/)
})

test('手改坏的文件当没有，表格页照样能打开', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-panel-schema-'))
  writeFileSync(path.join(dir, 'enums.json'), '{ broken')
  writeFileSync(path.join(dir, 'style.json'), JSON.stringify({ key: 'Id' }))
  const s = await readSchema(dir)
  assert.equal(s.style.key, 'Id')
  assert.deepEqual(s.enums, {})
})

test('枚举扫描：规则存 enum-scans.json；结果并进枚举的 scanned，写回时不进 enums.json', async () => {
  const { writeScanResults } = await import('./enum-scan-store.ts')
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'agent-panel-schema-')), 'tables')
  const s = TableSchema.parse({
    enums: { Manual: { values: [{ name: 'A' }] }, Mixed: { values: [{ name: 'Extra' }] } },
    scans: [{ id: 'scan-1', from: { kind: 'block', file: 'Enum.xlsx', enumCol: 'A', nameCol: 'B' } }],
  })
  await writeSchema(dir, s)
  assert.match(readFileSync(path.join(dir, 'enum-scans.json'), 'utf8'), /scan-1/)
  await writeScanResults(dir, {
    'scan-1': { at: 'x', files: {}, enums: { Mixed: [{ name: 'S1' }], OnlyScan: [{ name: 'S2' }] }, warnings: [] },
    gone: { at: 'x', files: {}, enums: { Ghost: [{ name: 'g' }] }, warnings: [] },
  })
  const got = await readSchema(dir)
  assert.deepEqual(got.enums.Mixed.scanned, { by: 'scan-1', values: [{ name: 'S1' }] })
  assert.deepEqual(got.enums.OnlyScan, { values: [], scanned: { by: 'scan-1', values: [{ name: 'S2' }] } })
  assert.equal(got.enums.Ghost, undefined)
  // 页面把带 scanned 的整份交回来：enums.json 里不出现扫描结果，只靠扫描的枚举不写
  const back = await writeSchema(dir, got)
  const file = readFileSync(path.join(dir, 'enums.json'), 'utf8')
  assert.doesNotMatch(file, /S1|OnlyScan/)
  assert.deepEqual(back.enums.OnlyScan.scanned?.values, [{ name: 'S2' }])
  // 规则写坏了一条只丢那一条
  writeFileSync(path.join(dir, 'enum-scans.json'), JSON.stringify([{ id: '' }, s.scans[0]]))
  assert.equal((await readSchema(dir)).scans.length, 1)
})
