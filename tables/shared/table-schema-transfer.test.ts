/** 表格设置的导出和导入：扫描结果不带，导出的格式和直接一份结构都认，不是表格设置的照实报错 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TableSchema } from './tables.ts'
import { exportSchemaText, parseSchemaText, schemaBrief } from './table-schema-transfer.ts'

const schema = TableSchema.parse({
  style: { key: 'ID', header: { start: 0, rows: [{ kind: 'name' }, { kind: 'comment' }] } },
  enums: {
    Side: { values: [{ name: 'Client' }, { name: 'Public' }] },
    Scanned: { values: [], scanned: { by: 's1', values: [{ name: 'A' }] } },
  },
  scans: [
    { id: 's1', from: { kind: 'block', file: 'Excel/**/*.xlsx', sheet: 'EnumType', enumCol: 'A', nameCol: 'B' } },
  ],
  analyzedAt: '2026-11-16T00:00:00Z',
})

test('导出再导入：人写的设置原样回来，扫描结果和分析时间不带', () => {
  const text = exportSchemaText(schema)
  assert.ok(!text.includes('scanned'))
  assert.ok(!text.includes('analyzedAt'))
  const back = parseSchemaText(text)
  assert.ok(back.schema, back.error ?? '')
  assert.deepEqual(Object.keys(back.schema.enums), ['Side'])
  assert.equal(back.schema.scans[0].id, 's1')
  assert.equal(back.schema.style.key, 'ID')
  assert.equal(schemaBrief(back.schema), '表头 2 行，1 个枚举，1 条扫描规则')
})

test('直接贴一份结构也认；不是 JSON、不是表格设置的照实报错', () => {
  assert.ok(parseSchemaText(JSON.stringify({ style: { key: 'Id' } })).schema)
  assert.match(parseSchemaText('hello').error ?? '', /JSON/)
  assert.ok(parseSchemaText('{"foo":1}').error)
})
