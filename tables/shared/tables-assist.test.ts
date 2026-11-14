/** AI 分析表格风格：提示词带上样本，JSON 校验，勾选的几项并进结构文件 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TableSchema } from './tables.ts'
import {
  applyTablesDraft,
  buildTablesBody,
  draftItemIds,
  resolveTablesProposal,
  tablesJsonOf,
} from './tables-assist.ts'

const draft = {
  summary: '5 行表头',
  style: {
    header: {
      start: 0,
      rows: [
        { kind: 'modifier', values: 'Modifier' },
        { kind: 'side', label: '导出端' },
        { kind: 'type', values: '@types' },
        { kind: 'name' },
        { kind: 'comment' },
      ],
    },
    key: 'Id',
    listSep: '|',
    exceptions: [
      { glob: 'Enum/*.xlsx', header: { start: 0, rows: [{ kind: 'type' }, { kind: 'name' }] }, why: '枚举表' },
    ],
  },
  enums: { Size: { values: [{ name: 'S' }, { name: 'M' }] } },
  columns: { 'a.xlsx#*#Role': { ref: 'b.xlsx#ID' } },
}

test('提示词带上样本和对话', () => {
  const p = buildTablesBody({ sample: '### a.xlsx\n1\tID' }, [{ role: 'user', text: '主键是 Id' }])
  assert.match(p, /### a\.xlsx/)
  assert.match(p, /主键是 Id/)
  assert.match(p, /```tables-style/)
})

test('JSON 校验：不认识的 kind 改成「其它」并留作行名，格式错才报错，缺的部分给默认', () => {
  const odd = resolveTablesProposal({ style: { header: { start: 0, rows: [{ kind: 'name' }, { kind: 'default' }] } } })
  assert.deepEqual(odd.proposal?.draft.style.header, {
    start: 0,
    rows: [{ kind: 'name' }, { kind: 'other', label: 'default' }],
  })
  const bad = resolveTablesProposal({ style: { header: { start: -1, rows: [{ kind: 'name' }] } } })
  assert.ok(bad.error?.includes('style.header.start'))
  const ok = resolveTablesProposal({})
  assert.deepEqual(ok.proposal?.draft.enums, {})
  assert.equal(ok.proposal?.kind, 'tables')
})

test('只并勾上的项：按文件指定按 glob + 工作表换，枚举保留原来的取值来源，记下分析时间', () => {
  const d = resolveTablesProposal(draft).proposal!.draft
  assert.deepEqual(draftItemIds(d), ['header', 'key', 'listSep', 'ex:0', 'enum:Size', 'col:a.xlsx#*#Role'])
  const schema = TableSchema.parse({
    style: {
      key: 'ID',
      exceptions: [
        { glob: 'Enum/*.xlsx', header: { start: 1, rows: [{ kind: 'name' }] } },
        { glob: 'Enum/*.xlsx', sheet: 'S', header: { start: 2, rows: [{ kind: 'name' }] } },
      ],
    },
    enums: { Size: { values: [], source: { file: 'e.xlsx', nameCol: 'Name' } } },
  })
  const next = applyTablesDraft(schema, d, new Set(['header', 'ex:0', 'enum:Size']), '2026-11-11T00:00:00Z')
  assert.equal(next.style.key, 'ID')
  assert.equal(next.style.listSep, ';')
  assert.deepEqual(
    next.style.header.rows.map((r) => r.kind),
    ['modifier', 'side', 'type', 'name', 'comment'],
  )
  assert.equal(next.style.header.rows[0].values, 'Modifier')
  assert.deepEqual(next.style.exceptions, [
    { glob: 'Enum/*.xlsx', sheet: 'S', header: { start: 2, rows: [{ kind: 'name' }] } },
    { glob: 'Enum/*.xlsx', header: { start: 0, rows: [{ kind: 'type' }, { kind: 'name' }] } },
  ])
  assert.equal(next.enums.Size.source?.file, 'e.xlsx')
  assert.deepEqual(
    next.enums.Size.values.map((v) => v.name),
    ['S', 'M'],
  )
  assert.deepEqual(next.columns, {})
  assert.equal(next.analyzedAt, '2026-11-11T00:00:00Z')
  assert.ok(TableSchema.safeParse(next).success)
})

test('AI 还按旧格式（几套 headers、roles、roleEnums）回答：取第一套，按种类的取值落到对应行上', () => {
  const d = resolveTablesProposal({
    style: {
      headers: [
        { start: 0, roles: ['modifier', 'type', 'name'] },
        { start: 1, roles: ['name'] },
      ],
      arrayMarks: ['repeated', 'list'],
      roleEnums: { modifier: 'Modifier' },
    },
  }).proposal!.draft
  assert.deepEqual(d.style.header, {
    start: 0,
    rows: [{ kind: 'modifier', values: 'Modifier' }, { kind: 'type' }, { kind: 'name' }],
  })
  assert.deepEqual(draftItemIds(d), ['header', 'arrayMarks'])
  const next = applyTablesDraft(TableSchema.parse({}), d, new Set(draftItemIds(d)), 'x')
  assert.deepEqual(next.style.header, d.style.header)
  assert.deepEqual(next.style.arrayMarks, ['repeated', 'list'])
})

test('分析结果里的类型和容器写法：写坏的类型丢掉，勾上的写进类型表', () => {
  const r = resolveTablesProposal({
    types: {
      FVector: { kind: 'struct', fields: [{ name: 'X', type: 'float' }], store: '{X}' },
      Bad: { kind: 'nope' },
    },
    formats: { mapStore: { entry: '{K}={V}' } },
  })
  const d = r.proposal!.draft
  assert.deepEqual(Object.keys(d.types), ['FVector'])
  assert.ok(draftItemIds(d).includes('type:FVector'))
  assert.ok(draftItemIds(d).includes('formats'))
  const s = applyTablesDraft(TableSchema.parse({}), d, new Set(['type:FVector', 'formats']), 'now')
  assert.equal(s.types.FVector.store, '{X}')
  assert.equal(s.style.formats.mapStore.entry, '{K}={V}')
  assert.equal(s.style.formats.mapStore.sep, ';')
})

test('结果取 tables-style 代码块的最后一个，没有时交给旧的 json 解析', () => {
  const fb = () => ({ json: 'old' })
  const text = '说明\n```tables-style\n{"a":1}\n```\n改一下\n```tables-style\n{"a":2}\n```'
  assert.deepEqual(tablesJsonOf(text, fb), { json: { a: 2 } })
  assert.deepEqual(tablesJsonOf('```json\n{}\n```', fb), { json: 'old' })
  assert.match(tablesJsonOf('```tables-style\n{坏\n```', fb).error ?? '', /JSON 解析失败/)
})
