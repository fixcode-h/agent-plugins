/** 一张表的「AI 识别表头」：提示词带上这张表、项目表头和核对结论，结果块按 tables-header 认 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TableSchema } from './tables.ts'
import { TABLE_HEADER_LANG, buildHeaderPrompt, headerVerdict } from './table-header-ai.ts'
import { resolveTablesProposal, tablesJsonOf } from './tables-assist.ts'

const schema = TableSchema.parse({
  style: {
    header: {
      start: 0,
      rows: [
        { kind: 'modifier', values: 'Modifier' },
        { kind: 'side' },
        { kind: 'type', values: '@types' },
        { kind: 'name' },
      ],
    },
  },
  enums: { Modifier: { values: [{ name: 'optional' }, { name: 'repeated' }] } },
})
const rows = [
  ['optional', 'optional'],
  ['Everyone', 'Nobody'],
  ['uint32', 'string'],
  ['ID', 'Name'],
  ['1', 'a'],
]

test('提示词带这张表开头几行、项目表头和哪一行对不上', () => {
  const verdict = headerVerdict(schema, 'Config/A.xlsx', 'Slot', rows)
  assert.match(verdict, /第 2 行不像「导出端」/)
  const p = buildHeaderPrompt({ file: 'Config/A.xlsx', sheet: 'Slot', rows, schema, verdict, langWord: '中文' })
  assert.match(p, /文件：Config\/A\.xlsx/)
  assert.match(p, /2\tEveryone\tNobody/)
  assert.match(p, /"Modifier":\["optional","repeated"\]/)
  assert.ok(p.includes('```' + TABLE_HEADER_LANG))
})

test('结果块按 tables-header 认，和整项目分析的块分开', () => {
  const reply = `说明\n\`\`\`${TABLE_HEADER_LANG}\n{"summary":"x","style":{"exceptions":[{"glob":"Config/A.xlsx","sheet":"Slot","header":{"start":0,"rows":[{"kind":"name"}]}}]},"enums":{}}\n\`\`\``
  const ex = tablesJsonOf(reply, () => ({ error: 'none' }), TABLE_HEADER_LANG)
  const r = resolveTablesProposal(ex.json)
  assert.equal(r.proposal?.draft.style.exceptions?.[0]?.sheet, 'Slot')
  assert.equal(tablesJsonOf(reply, () => ({ error: 'none' })).error, 'none')
})

test('AI 照着 @types 把枚举名写成 @Side 时去掉 @，enums 写成数组也认', () => {
  const r = resolveTablesProposal({
    style: {
      header: {
        start: 0,
        rows: [
          { kind: 'side', values: '@sides' },
          { kind: 'type', values: '@types' },
        ],
      },
    },
    enums: { sides: ['Client', 'Everyone'] },
  })
  const rows = r.proposal?.draft.style.header?.rows ?? []
  assert.equal(rows[0]?.values, 'sides')
  assert.equal(rows[1]?.values, '@types')
  assert.deepEqual(
    r.proposal?.draft.enums.sides?.values.map((v) => v.name),
    ['Client', 'Everyone'],
  )
})
