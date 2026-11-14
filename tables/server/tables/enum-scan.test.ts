/** 枚举扫描执行：手动扫、自动刷新只在源文件变了时扫、失败留旧结果、试跑不写 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TableSchema, TablesConfig } from '../../shared/tables.ts'
import { runScans, scanOnce } from './enum-scan.ts'
import { readScanResults } from './enum-scan-store.ts'

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-panel-scan-'))
  writeFileSync(path.join(dir, 'Enum.csv'), 'EColor,,\n,Red,0\n,Green,1\n')
  const schema = TableSchema.parse({
    scans: [
      {
        id: 's1',
        from: { kind: 'block', file: 'Enum.csv', enumCol: 'A', nameCol: 'B', valueCol: 'C' },
        rename: { stripPrefix: 'E' },
      },
      { id: 's2', auto: 'off', from: { kind: 'block', file: 'Missing.csv', enumCol: 'A', nameCol: 'B' } },
    ],
  })
  const ctx = {
    dir,
    cfg: TablesConfig.parse({ dirs: ['.'] }),
    schemaAt: path.join(dir, '.agentpanel', 'tables'),
    schema,
  }
  return { dir, ctx }
}

test('手动扫全部：扫出的写进结果；文件不在的报错不抛', async () => {
  const { ctx } = setup()
  const runs = await runScans(ctx, {})
  assert.equal(runs.length, 2)
  assert.deepEqual(
    runs[0].enums.Color.map((v) => v.name),
    ['Red', 'Green'],
  )
  assert.deepEqual(runs[0].diff.added, ['Color'])
  assert.match(runs[1].error ?? '', /Missing/)
  const saved = await readScanResults(ctx.schemaAt)
  assert.equal(saved.s1.enums.Color.length, 2)
})

test('自动刷新：只看 open 的规则，源文件没变不扫，变了才扫', async () => {
  const { dir, ctx } = setup()
  await runScans(ctx, { ids: ['s1'] })
  assert.equal((await runScans(ctx, { auto: true })).length, 0)
  writeFileSync(path.join(dir, 'Enum.csv'), 'EColor,,\n,Red,0\n,Blue,2\n')
  const t = new Date(Date.now() + 5000)
  utimesSync(path.join(dir, 'Enum.csv'), t, t)
  assert.equal((await runScans(ctx, { auto: true, file: 'Other.csv' })).length, 0)
  const runs = await runScans(ctx, { auto: true, file: 'Enum.csv' })
  assert.equal(runs.length, 1)
  assert.deepEqual(runs[0].diff.changed, [{ name: 'Color', added: ['Blue'], removed: ['Green'], modified: [] }])
})

test('扫描失败时旧结果留着，记下错误', async () => {
  const { dir, ctx } = setup()
  await runScans(ctx, { ids: ['s1'] })
  const rule = ctx.schema.scans[0]
  const prev = (await readScanResults(ctx.schemaAt)).s1
  const r = await scanOnce({ ...ctx }, { ...rule, from: { ...rule.from, file: 'Gone.csv' } }, prev)
  assert.ok(r.error)
  assert.equal(r.result.enums.Color.length, 2)
  void dir
})
