/** 填充柄的规律、整行插入和移动 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extendSeries, fillHandle } from './table-fill.ts'
import { insertRowsCells, moveRowsCells } from './table-rows.ts'

test('填充柄：两格以上数字按步长递增，一格数字复制，Ctrl 对调', () => {
  assert.deepEqual(extendSeries(['1', '3'], 3), ['5', '7', '9'])
  assert.deepEqual(extendSeries(['1001'], 2), ['1001', '1001'])
  assert.deepEqual(extendSeries(['1001'], 2, true), ['1002', '1003'])
  assert.deepEqual(extendSeries(['1', '3'], 3, true), ['1', '3', '1'])
  // 大整数不丢精度，小数按原来的位数
  assert.deepEqual(extendSeries(['9007199254740993', '9007199254740994'], 1), ['9007199254740995'])
  assert.deepEqual(extendSeries(['0.1', '0.2'], 2), ['0.3', '0.4'])
  assert.deepEqual(extendSeries(['0.5', '1'], 2), ['1.5', '2.0'])
})

test('填充柄：结尾带数字的文字往后数并保留补的 0，Ctrl 时复制；别的文字轮流复制', () => {
  assert.deepEqual(extendSeries(['Icon_09'], 2), ['Icon_10', 'Icon_11'])
  assert.deepEqual(extendSeries(['Item1'], 2, true), ['Item1', 'Item1'])
  assert.deepEqual(extendSeries(['Lv01', 'Lv03'], 2), ['Lv05', 'Lv07'])
  assert.deepEqual(extendSeries(['A1', 'B1'], 3), ['A2', 'B2', 'A3'])
  assert.deepEqual(extendSeries(['火', '水'], 3), ['火', '水', '火'])
  // 负数不是「- 加数字」的文字
  assert.deepEqual(extendSeries(['-1', '-2'], 1), ['-3'])
})

test('填充柄：往上从靠近选区的一端倒着数，往右按行算', () => {
  const g = [
    ['', ''],
    ['', ''],
    ['3', 'a1'],
    ['4', 'x'],
  ]
  assert.deepEqual(fillHandle(g, { rows: [2, 3], cols: [0] }, 'up', [0, 1]), [
    { r: 1, c: 0, v: '2' },
    { r: 0, c: 0, v: '1' },
  ])
  assert.deepEqual(fillHandle([['5', '']], { rows: [0], cols: [0] }, 'right', [1], true), [{ r: 0, c: 1, v: '6' }])
})

test('插几行：主键从下一个编号起依次 +1，表头里插不编号', () => {
  const rows = [['ID'], ['1001'], ['1005']]
  assert.deepEqual(insertRowsCells(rows, { at: 3, n: 2, from: 1, keyCol: 0 }), [
    { r: 3, c: 0, v: '1006' },
    { r: 4, c: 0, v: '1007' },
  ])
  assert.deepEqual(insertRowsCells(rows, { at: 0, n: 1, from: 1, keyCol: 0 }), [])
  assert.deepEqual(insertRowsCells([['a', 'b']], { at: 1, n: 1, from: 0, keyCol: -1, copy: 0 }), [
    { r: 1, c: 0, v: 'a' },
    { r: 1, c: 1, v: 'b' },
  ])
})

test('移动行：内容轮换，只改变了的格子；挪进表头或挪出表尾不行', () => {
  const rows = [['h'], ['1', 'x'], ['2'], ['3']]
  // 第 2、3 行（下标 2、3）上移一行：1 换到最后
  assert.deepEqual(moveRowsCells(rows, 2, 2, -1, 1), [
    { r: 1, c: 0, v: '2' },
    { r: 1, c: 1, v: '' },
    { r: 2, c: 0, v: '3' },
    { r: 3, c: 0, v: '1' },
    { r: 3, c: 1, v: 'x' },
  ])
  assert.deepEqual(moveRowsCells(rows, 1, 1, 1, 1)?.length, 4)
  assert.equal(moveRowsCells(rows, 1, 1, -1, 1), null)
  assert.equal(moveRowsCells(rows, 3, 1, 1, 1), null)
})
