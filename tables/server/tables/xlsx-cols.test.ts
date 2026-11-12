/**
 * 增删列：xlsx 原地挪列号和 <cols> 的列宽区间，追加在末尾总可以；有公式、合并单元格、数据验证、
 * 被别的表引用的表不让在中间插删列。CSV 照常做。页面和服务端用同一份 applyColOps。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readXlsx } from '../xlsx.ts'
import { applyColOps, applyOps, gridDiff, mapCol, setCells, type SheetEdit } from '../../shared/table-edit.ts'
import { entryText, readZip, writeZip } from './zip.ts'
import { editXlsx } from './xlsx-write.ts'
import { gameBook } from './xlsx-fixture.ts'
import { referencedElsewhere, shiftColDefs } from './xlsx-shift.ts'

const dataDir = mkdtempSync(path.join(tmpdir(), 'agent-panel-tables-cols-'))
process.env.AGENT_PANEL_DATA = dataDir

function roundtrip(buf: Buffer, edits: SheetEdit[]) {
  const before = readXlsx(buf)
  const out = editXlsx(buf, edits)
  const after = readXlsx(out)
  for (const e of edits) {
    const want = setCells(applyOps(before.find((s) => s.name === e.name)!.rows, e.rows, e.cols), e.cells)
    assert.equal(gridDiff(after.find((s) => s.name === e.name)!.rows, want), null)
  }
  return out
}
const sheet1 = (buf: Buffer) => entryText(readZip(buf), 'xl/worksheets/sheet1.xml')!
/** 换掉 zip 里的一个条目（造带引用、数据验证的表） */
function patch(buf: Buffer, name: string, f: (xml: string) => string) {
  const zip = readZip(buf)
  return writeZip(zip, new Map([[name, f(entryText(zip, name)!)]]))
}

test('applyColOps：插入空列、删列，行比插入位置短的不补；mapCol 算出格子挪到哪', () => {
  const rows = [['a', 'b', 'c'], ['x'], []]
  assert.deepEqual(applyColOps(rows, [{ at: 1, n: 2 }]), [['a', '', '', 'b', 'c'], ['x'], []])
  assert.deepEqual(applyColOps(rows, [{ at: 0, n: -2 }]), [['c'], [], []])
  // 先插后删：删的是插完以后的位置
  assert.deepEqual(
    applyColOps(rows, [
      { at: 1, n: 1 },
      { at: 0, n: -1 },
    ]),
    [['', 'b', 'c'], [], []],
  )
  assert.equal(mapCol(2, [{ at: 1, n: 1 }]), 3)
  assert.equal(mapCol(1, [{ at: 1, n: -1 }]), -1)
  assert.equal(mapCol(3, [{ at: 0, n: -2 }]), 1)
  // 和行操作谁先谁后一样
  const ops = [{ at: 1, n: 1 }]
  const cols = [{ at: 1, n: 1 }]
  assert.deepEqual(applyOps(rows, ops, cols), applyColOps(applyOps(rows, ops), cols))
})

test('中间插一列并填表头：后面的格子列号后移，样式号留着，列宽区间不受影响', () => {
  const out = roundtrip(gameBook(), [
    {
      name: '道具',
      rows: [],
      cols: [{ at: 1, n: 1 }],
      cells: [
        { r: 0, c: 1, v: 'optional' },
        { r: 1, c: 1, v: 'uint32' },
        { r: 2, c: 1, v: 'Price' },
        { r: 3, c: 1, v: '100' },
      ],
    },
  ])
  const xml = sheet1(out)
  assert.match(xml, /<c r="C4" s="3" t="s"><v>6<\/v><\/c>/)
  assert.match(xml, /<c r="E4" s="4"><v>46023<\/v><\/c>/)
  assert.match(xml, /<c r="B4" s="3"><v>100<\/v><\/c>/)
  assert.ok(xml.includes('<cols><col min="1" max="1" width="12" customWidth="1"/></cols>'))
  assert.match(xml, /<dimension ref="A1:E6"\/>/)
  // 挪过的行去掉 spans（提示不准了）
  assert.ok(!/<row r="4" spans=/.test(xml))
})

test('在最前面插列：列宽区间跟着右移；删掉第一列：区间整个去掉', () => {
  const ins = sheet1(roundtrip(gameBook(), [{ name: '道具', rows: [], cols: [{ at: 0, n: 2 }], cells: [] }]))
  assert.ok(ins.includes('<cols><col min="3" max="3" width="12" customWidth="1"/></cols>'))
  const del = sheet1(roundtrip(gameBook(), [{ name: '道具', rows: [], cols: [{ at: 0, n: -1 }], cells: [] }]))
  assert.ok(!del.includes('<cols>'))
  assert.match(del, /<c r="A3" s="2" t="s"><v>4<\/v><\/c>/)
})

test('<cols> 区间：插在区间里面变宽，删一部分变窄', () => {
  const head = '<cols><col min="2" max="4" width="9"/><col min="6" max="6" hidden="1"/></cols>'
  assert.equal(
    shiftColDefs(head, [{ at: 2, n: 1 }]),
    '<cols><col min="2" max="5" width="9"/><col min="7" max="7" hidden="1"/></cols>',
  )
  assert.equal(
    shiftColDefs(head, [{ at: 2, n: -3 }]),
    '<cols><col min="2" max="2" width="9"/><col min="3" max="3" hidden="1"/></cols>',
  )
})

test('拒绝规则：有公式、合并单元格、数据验证、被别的表引用时不能在中间插删列；追加在末尾总可以', () => {
  const mid = (buf: Buffer) => () => editXlsx(buf, [{ name: '道具', rows: [], cols: [{ at: 1, n: 1 }], cells: [] }])
  assert.throws(mid(gameBook({ formulaSheet1: true })), /公式.*不能在中间插入或删除列/)
  assert.throws(mid(gameBook({ merge: true })), /合并单元格/)
  const dv = patch(gameBook(), 'xl/worksheets/sheet1.xml', (x) =>
    x.replace(
      '<pageMargins',
      '<dataValidations count="1"><dataValidation type="list" sqref="C4:C6"><formula1>"Sword,Axe"</formula1></dataValidation></dataValidations><pageMargins',
    ),
  )
  assert.throws(mid(dv), /数据验证/)
  const cross = patch(gameBook(), 'xl/worksheets/sheet2.xml', (x) => x.replace('<f>A1*2</f>', '<f>SUM(道具!A4:A6)</f>'))
  assert.throws(mid(cross), /别的工作表或图表引用了这张表/)
  // 统计表里的公式没指到「道具」：不挡
  roundtrip(gameBook(), [{ name: '道具', rows: [], cols: [{ at: 1, n: -1 }], cells: [] }])
  // 有公式的表在最后一列后面加列：可以
  roundtrip(gameBook({ formulaSheet1: true }), [
    { name: '道具', rows: [], cols: [{ at: 4, n: 1 }], cells: [{ r: 2, c: 4, v: 'Price' }] },
  ])
})

test('跨表引用：带引号的表名、名字是别的表名的一部分时不误判', () => {
  assert.ok(referencedElsewhere("My Sheet's", ["<f>'My Sheet''s'!A1</f>"]))
  assert.ok(referencedElsewhere('道具', ['<c:f>道具!$A$1:$A$3</c:f>']))
  assert.ok(!referencedElsewhere('道具', ['<f>旧道具!A1</f>']))
  assert.ok(referencedElsewhere('道具', ['<worksheetSource ref="A1:C9" sheet="道具"/>']))
})

test('行列一起改：插一行一列再填格子，读回来和预期一样', () => {
  roundtrip(gameBook(), [
    {
      name: '道具',
      rows: [{ at: 4, n: 1 }],
      cols: [{ at: 2, n: 1 }],
      cells: [
        { r: 4, c: 0, v: '9' },
        { r: 2, c: 2, v: 'Weight' },
        { r: 4, c: 2, v: '1.5' },
      ],
    },
  ])
})

test('CSV：加列删列照常保存，分隔符和换行不变', async () => {
  const { TablesConfig } = await import('../../shared/tables.ts')
  const { saveTable } = await import('./write.ts')
  const { openTable } = await import('./files.ts')
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-panel-tables-cols-csv-'))
  mkdirSync(path.join(dir, 'Config'))
  writeFileSync(path.join(dir, 'Config', 'Shop.csv'), '﻿ID,Name\r\n1,"a,b"\r\n2,x\r\n')
  const cfg = TablesConfig.parse({ dirs: ['Config'] })
  const doc = await openTable(dir, 'Config/Shop.csv', cfg)
  const next = await saveTable(dir, 'p1', cfg, {
    path: 'Config/Shop.csv',
    mtime: doc.mtime,
    sheets: [{ name: doc.sheets[0].name, rows: [], cols: [{ at: 1, n: 1 }], cells: [{ r: 0, c: 1, v: 'Price' }] }],
  })
  assert.deepEqual(next.sheets[0].rows[0], ['ID', 'Price', 'Name'])
  assert.equal(readFileSync(path.join(dir, 'Config', 'Shop.csv'), 'utf8'), '﻿ID,Price,Name\r\n1,,"a,b"\r\n2,,x\r\n')
})

test('shiftReasons：每张表的拒绝原因和用到的最后一列', async () => {
  const { shiftReasons } = await import('./xlsx-write.ts')
  assert.deepEqual(shiftReasons(gameBook()), { 道具: { why: [], last: 3 }, 统计: { why: ['公式'], last: 1 } })
  assert.deepEqual(shiftReasons(gameBook({ merge: true })).道具.why, ['合并单元格'])
})
