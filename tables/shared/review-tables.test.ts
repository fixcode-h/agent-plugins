import assert from 'node:assert/strict'
import test from 'node:test'
import { workbookDiffText } from './review-tables.ts'
import { TableSchema } from './tables.ts'

const schema = TableSchema.parse({})
const head = [
  ['optional', 'optional', 'optional'],
  ['uint32', 'string', 'uint32'],
  ['ID', 'Name', 'Price'],
]
const book = (rows: string[][], name = '道具') => [{ name, rows: [...head, ...rows] }]

test('表格语义差异：按字段名写出改了哪格、加删了哪行', () => {
  const a = book([
    ['1', '木剑', '100'],
    ['2', '铁剑', '200'],
  ])
  const b = book([
    ['1', '木剑', '120'],
    ['3', '金剑', '500'],
  ])
  const text = workbookDiffText('Data/Item.xlsx', a, b, schema)
  assert.match(text, /工作表「道具」/)
  assert.match(text, /Price 100 → 120/, '改了的格子写字段名和前后的值')
  assert.match(text, /金剑/, '新加的行写出内容')
  assert.match(text, /铁剑/, '删掉的行写出原来的内容')
})

test('表格语义差异：两版一样时为空，新建、删表、加工作表都说清', () => {
  const a = book([['1', '木剑', '100']])
  assert.equal(workbookDiffText('x.xlsx', a, a, schema), '')
  assert.match(workbookDiffText('x.xlsx', null, a, schema), /新建的表格[\s\S]*1 行数据/)
  assert.match(workbookDiffText('x.xlsx', a, null, schema), /删掉的表格/)
  const more = [...a, { name: '掉落', rows: [['ID'], ['1']] }]
  assert.match(workbookDiffText('x.xlsx', a, more, schema), /新加的工作表[\s\S]*掉落/)
  assert.match(workbookDiffText('x.xlsx', more, a, schema), /删掉的工作表[\s\S]*掉落/)
})
