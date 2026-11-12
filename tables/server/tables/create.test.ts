/** 新建表格：xlsx / CSV 写进表格目录，读回来和填的一样，之后还能原地改格子；不覆盖、不出表格目录 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TablesConfig } from '../../shared/tables.ts'
import { ruleOf } from '../../shared/table-header.ts'
import { newTableIssues, newTableRows } from '../../shared/table-create.ts'
import { createTable } from './create.ts'
import { parseTable } from './files.ts'
import { editXlsx } from './xlsx-write.ts'

const rule = ruleOf(['type', 'name', 'comment'], 1)
const cols = [{ cells: ['uint32', 'ID', '编号'] }, { cells: ['string', 'Name', '名字 & <说明>'] }]

test('按表头配置拼行：start 前留空行，每列按表头各行填', () => {
  assert.deepEqual(newTableRows(rule, cols), [[], ['uint32', 'string'], ['ID', 'Name'], ['编号', '名字 & <说明>']])
  const none = () => false
  assert.deepEqual(newTableIssues('Item.xlsx', 'Sheet1', rule, cols, none), [])
  assert.equal(newTableIssues('Item.txt', 'S', rule, cols, none).length, 1)
  assert.equal(newTableIssues('../x.csv', 'S', rule, cols, none).length, 1)
  assert.equal(newTableIssues('Item.csv', 'S', rule, cols, () => true).length, 1)
  assert.equal(newTableIssues('Item.xlsx', 'a/b', rule, cols, none).length, 1)
  const dup = [{ cells: ['int', 'ID', ''] }, { cells: ['int', 'ID', ''] }, { cells: ['int', '', ''] }]
  assert.equal(newTableIssues('Item.csv', 'S', rule, dup, none).length, 2)
})

test('新建 xlsx 和 CSV：读回来一样，xlsx 之后能原地改；已有的不覆盖，表格目录外不让建', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-panel-table-create-'))
  mkdirSync(path.join(dir, 'Config'))
  const cfg = TablesConfig.parse({ dirs: ['Config'] })
  const rows = newTableRows(rule, cols)
  const r = await createTable(dir, cfg, { path: 'Config/Sub/Item.xlsx', sheet: '道具', rows, freeze: 4 })
  assert.equal(r.path, 'Config/Sub/Item.xlsx')
  const full = path.join(dir, r.path)
  const { sheets } = await parseTable(full)
  assert.equal(sheets[0].name, '道具')
  assert.deepEqual(sheets[0].rows.slice(1), rows.slice(1))
  // 新表加一行数据：走表格页保存用的原地改写
  writeFileSync(full, editXlsx(readFileSync(full), [{ name: '道具', rows: [], cells: [{ r: 4, c: 0, v: '1' }] }]))
  assert.equal((await parseTable(full)).sheets[0].rows[4][0], '1')

  await createTable(dir, cfg, { path: 'Config/Item.csv', sheet: 'Sheet1', rows, freeze: 0 })
  assert.equal(
    readFileSync(path.join(dir, 'Config/Item.csv'), 'utf8'),
    '﻿\r\nuint32,string\r\nID,Name\r\n编号,名字 & <说明>\r\n',
  )

  await assert.rejects(createTable(dir, cfg, { path: 'Config/Item.csv', sheet: 'S', rows, freeze: 0 }), /已经有|exists/)
  await assert.rejects(
    createTable(dir, cfg, { path: 'Other.csv', sheet: 'S', rows, freeze: 0 }),
    /表格目录|table folder/,
  )
  await assert.rejects(
    createTable(dir, { ...cfg, readOnly: true }, { path: 'Config/B.csv', sheet: 'S', rows, freeze: 0 }),
    /只读|read-only/,
  )
})
