/** 表格配置和结构文件的小工具：通配匹配、开没开表格功能、表头的优先级、列结构的查找 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TableSchema, globHit, globList, schemaColumn, schemaHeader, tableKind, tablesOn } from './tables.ts'
import { ruleOf } from './table-header.ts'

test('通配：不带 / 的只比文件名，带 / 的比相对路径，** 跨目录', () => {
  const g = globList('*.xlsx, ~$*\n Design/**/*.csv')
  assert.deepEqual(g, ['*.xlsx', '~$*', 'Design/**/*.csv'])
  assert.ok(globHit('Config/sub/Item.XLSX', g))
  assert.ok(globHit('Config/~$Item.xlsx', ['~$*']))
  assert.ok(globHit('Design/a/b/x.csv', g))
  assert.ok(!globHit('Config/x.csv', g))
  assert.ok(!globHit('Config/sub/x.xlsx', ['Config/*.xlsx']))
  assert.ok(globHit('Config/a.b.xlsx', ['a.b.xlsx']))
  assert.ok(!globHit('Config/aXb.xlsx', ['a.b.xlsx']))
})

test('种类和开关', () => {
  assert.equal(tableKind('a.XLSM'), 'xlsx')
  assert.equal(tableKind('a.tsv'), 'csv')
  assert.equal(tableKind('a.et'), 'xls')
  assert.equal(tableKind('a.md'), null)
  assert.equal(tablesOn(undefined), false)
  assert.equal(tablesOn({ dirs: [] }), false)
  assert.equal(tablesOn({ dirs: ['Config'] }), true)
})

test('表头只按配置：只管这个工作表的 > 按通配的（排前面的优先，通配空着不生效）> 项目表头；列结构：本工作表 > 每张表', () => {
  const own = ruleOf(['name'], 2)
  const ex = ruleOf(['type', 'name'], 1)
  const style = ruleOf(['modifier', 'type', 'name'])
  const s = TableSchema.parse({
    style: {
      header: style,
      exceptions: [
        { glob: 'Config/A.xlsx', sheet: 'Sheet1', header: own },
        { glob: '', header: ruleOf(['comment']) },
        { glob: 'Enum/*.xlsx', header: ex },
      ],
    },
    columns: { 'Config/A.xlsx#*#Type': { enum: 'T' }, 'Config/A.xlsx#Sheet2#Type': { enum: 'U' } },
  })
  assert.deepEqual(schemaHeader(s, 'Config/A.xlsx', 'Sheet1'), { rule: own, source: { kind: 'sheet', index: 0 } })
  assert.deepEqual(schemaHeader(s, 'Config/A.xlsx', 'Sheet2'), { rule: style, source: { kind: 'project' } })
  assert.deepEqual(schemaHeader(s, 'Enum/E.xlsx', 'Sheet1'), { rule: ex, source: { kind: 'file', index: 2 } })
  assert.deepEqual(schemaHeader(TableSchema.parse({}), 'x.xlsx', 's').rule, { start: 0, rows: [] })
  assert.equal(schemaColumn(s, 'Config/A.xlsx', 'Sheet1', 'Type')?.enum, 'T')
  assert.equal(schemaColumn(s, 'Config/A.xlsx', 'Sheet2', 'Type')?.enum, 'U')
  assert.equal(schemaColumn(s, 'Config/A.xlsx', 'Sheet1', 'Other'), undefined)
})
