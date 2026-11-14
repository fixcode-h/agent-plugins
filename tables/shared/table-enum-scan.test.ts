/** 枚举扫描：分组块（用户项目 EnumType 页签的写法）、每行写枚举名、一页一个枚举；换名、变化 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SheetData } from './files.ts'
import {
  ScanFrom,
  type SheetFrom,
  applyRename,
  colIndex,
  diffScan,
  diffLine,
  scanSheets,
  ScanRename,
} from './table-enum-scan.ts'

const sheetFrom = (x: unknown) => ScanFrom.parse(x) as SheetFrom
const noHeader = () => ({ names: [], dataFrom: 0 })

// 和截图里一样：A 列只在第一行写枚举名，B 成员名，C 值；没有表头
const enumType: SheetData = {
  name: 'EnumType',
  rows: [
    ['OutsideAttributeDisplayEntry', '', ''],
    ['', 'CharacterTotal', '1'],
    ['', 'CharacterLevel', '2'],
    ['', 'CharacterTalent', '3'],
    ['ItemQuality', '', ''],
    ['', 'White', '0'],
    ['', 'Blue', '1'],
    ['', 'Blue', '9'],
  ],
}

test('列号转下标', () => {
  assert.equal(colIndex('A'), 0)
  assert.equal(colIndex('C'), 2)
  assert.equal(colIndex('AA'), 26)
  assert.equal(colIndex('Name'), -1)
})

test('分组块：枚举名只写在第一行，下面的成员归它；重复成员只留第一个并提醒', () => {
  const from = sheetFrom({
    kind: 'block',
    file: 'Enum.xlsx',
    sheet: 'EnumType',
    enumCol: 'A',
    nameCol: 'B',
    valueCol: 'C',
  })
  const r = scanSheets(from, [{ name: 'Other', rows: [] }, enumType], noHeader, 'Enum.xlsx')
  assert.deepEqual(Object.keys(r.enums), ['OutsideAttributeDisplayEntry', 'ItemQuality'])
  assert.deepEqual(r.enums.OutsideAttributeDisplayEntry[0], { name: 'CharacterTotal', value: '1' })
  assert.equal(r.enums.ItemQuality.length, 2)
  assert.equal(r.warnings.length, 1)
})

test('列全写列号时不按项目表头跳行，从第 1 行开始', () => {
  const from = sheetFrom({ kind: 'block', file: 'Enum.xlsx', sheet: 'EnumType', enumCol: 'A', nameCol: 'B' })
  const r = scanSheets(from, [enumType], () => ({ names: ['x'], dataFrom: 3 }), 'Enum.xlsx')
  assert.equal(r.enums.OutsideAttributeDisplayEntry.length, 3)
})

test('每行写枚举名：按字段名找列，从表头下面开始', () => {
  const sheet: SheetData = {
    name: 'S',
    rows: [
      ['Enum', 'Name', 'Value', 'Desc'],
      ['EColor', 'Red', '0', '红'],
      ['EColor', 'Green', '1', ''],
      ['', 'Orphan', '2', ''],
      ['EShape', 'Box', '0', ''],
    ],
  }
  const from = sheetFrom({
    kind: 'rows',
    file: 'a.xlsx',
    enumCol: 'Enum',
    nameCol: 'Name',
    valueCol: 'Value',
    descCol: 'Desc',
  })
  const r = scanSheets(from, [sheet], () => ({ names: sheet.rows[0], dataFrom: 1 }), 'a.xlsx')
  assert.deepEqual(r.enums.EColor, [
    { name: 'Red', value: '0', desc: '红' },
    { name: 'Green', value: '1' },
  ])
  assert.deepEqual(r.enums.EShape, [{ name: 'Box', value: '0' }])
  assert.match(r.warnings[0], /1/)
})

test('一页一个枚举：页签名就是枚举名；找不到列时提醒', () => {
  const from = sheetFrom({ kind: 'sheets', file: 'e.xlsx', sheet: 'E*', nameCol: 'A', valueCol: 'B' })
  const r = scanSheets(
    from,
    [
      { name: 'EA', rows: [['x', '1']] },
      { name: 'Note', rows: [['y', '1']] },
      { name: 'EB', rows: [['z', '2']] },
    ],
    noHeader,
    'e.xlsx',
  )
  assert.deepEqual(Object.keys(r.enums), ['EA', 'EB'])
  const miss = scanSheets(sheetFrom({ ...from, nameCol: 'Name' }), [{ name: 'EA', rows: [] }], noHeader, 'e.xlsx')
  assert.equal(Object.keys(miss.enums).length, 0)
  assert.equal(miss.warnings.length, 1)
})

test('换名：去前缀、加前缀、手动对照；撞名合并', () => {
  const r = applyRename(
    { enums: { EColor: [{ name: 'Red' }], Color: [{ name: 'Blue' }], EX: [{ name: 'a' }] }, warnings: [] },
    ScanRename.parse({ stripPrefix: 'E', map: { EX: 'Special' } }),
  )
  assert.deepEqual(Object.keys(r.enums).sort(), ['Color', 'Special'])
  assert.deepEqual(
    r.enums.Color.map((x) => x.name),
    ['Red', 'Blue'],
  )
  assert.equal(r.warnings.length, 1)
})

test('变化：新增、去掉的枚举和成员、值变了的成员', () => {
  const d = diffScan(
    { A: [{ name: 'x', value: '1' }, { name: 'y' }], Gone: [{ name: 'z' }] },
    { A: [{ name: 'x', value: '2' }, { name: 'w' }], New: [{ name: 'n' }] },
  )
  assert.deepEqual(d.added, ['New'])
  assert.deepEqual(d.removed, ['Gone'])
  assert.deepEqual(d.changed, [{ name: 'A', added: ['w'], removed: ['y'], modified: ['x'] }])
  assert.match(diffLine(d), /1/)
})
