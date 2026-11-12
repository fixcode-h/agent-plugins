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
