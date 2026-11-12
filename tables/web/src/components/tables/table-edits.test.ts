/** 表格页的改动记录：改格子、插删行、撤销重做、算出要保存的内容和改过的格子 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SheetData } from '@shared/files'
import {
  colOpIn,
  dirtyCells,
  noEdits,
  pendingOf,
  redoIn,
  rowOpIn,
  rowOpsIn,
  rowsOf,
  setCellsIn,
  undoIn,
} from './table-edits'

const S: SheetData = {
  name: 'S',
  rows: [
    ['ID', 'Name'],
    ['1', 'a'],
  ],
}

test('改格子、插行、撤销重做；原表不变', () => {
  let e = setCellsIn(noEdits(), S, [{ r: 1, c: 1, v: 'b' }])
  assert.equal(setCellsIn(e, S, [{ r: 1, c: 1, v: 'b' }]), e, '值没变不进撤销')
  e = rowOpIn(e, S, { at: 2, n: 1 })
  e = setCellsIn(e, S, [{ r: 2, c: 0, v: '2' }])
  assert.deepEqual(rowsOf(e, S), [['ID', 'Name'], ['1', 'b'], ['2']])
  assert.deepEqual(S.rows[1], ['1', 'a'])
  assert.deepEqual(pendingOf(e, [S]), [
    {
      name: 'S',
      rows: [{ at: 2, n: 1 }],
      cells: [
        { r: 1, c: 1, v: 'b' },
        { r: 2, c: 0, v: '2' },
      ],
    },
  ])
  assert.deepEqual([...dirtyCells(e, S)], ['1:1', '2:0'])
  e = undoIn(undoIn(e))
  assert.deepEqual(rowsOf(e, S), [
    ['ID', 'Name'],
    ['1', 'b'],
  ])
  e = redoIn(e)
  assert.equal(rowsOf(e, S).length, 3)
  e = undoIn(undoIn(e))
  assert.equal(rowsOf(e, S), S.rows)
  assert.deepEqual(pendingOf(e, [S]), [])
})

test('改了又改回去：不算要保存的改动', () => {
  let e = setCellsIn(noEdits(), S, [{ r: 1, c: 1, v: 'b' }])
  e = setCellsIn(e, S, [{ r: 1, c: 1, v: 'a' }])
  assert.deepEqual(pendingOf(e, [S]), [])
  assert.equal(e.undo.length, 2)
})

test('一次删几行（从下往上）：一步撤销全回来', () => {
  const T: SheetData = { name: 'T', rows: [['ID'], ['1'], ['2'], ['3'], ['4']] }
  const e = rowOpsIn(noEdits(), T, [
    { at: 3, n: -1 },
    { at: 1, n: -1 },
  ])
  assert.deepEqual(rowsOf(e, T), [['ID'], ['2'], ['4']])
  assert.equal(rowsOf(undoIn(e), T), T.rows)
})

test('插列填表头、删列：一次撤销退掉；删掉的列不算改过的格子，后面的改格子保留列操作', () => {
  let e = colOpIn(noEdits(), S, { at: 1, n: 1 }, [{ r: 0, c: 1, v: 'Price' }])
  assert.deepEqual(rowsOf(e, S), [
    ['ID', 'Price', 'Name'],
    ['1', '', 'a'],
  ])
  e = setCellsIn(e, S, [{ r: 1, c: 1, v: '9' }])
  assert.deepEqual(pendingOf(e, [S]), [
    {
      name: 'S',
      rows: [],
      cols: [{ at: 1, n: 1 }],
      cells: [
        { r: 0, c: 1, v: 'Price' },
        { r: 1, c: 1, v: '9' },
      ],
    },
  ])
  e = colOpIn(e, S, { at: 2, n: -1 })
  assert.deepEqual(rowsOf(e, S), [
    ['ID', 'Price'],
    ['1', '9'],
  ])
  assert.deepEqual([...dirtyCells(e, S)], ['0:1', '1:1'])
  e = undoIn(e)
  assert.deepEqual(rowsOf(e, S)[0], ['ID', 'Price', 'Name'])
  e = undoIn(undoIn(e))
  assert.deepEqual(pendingOf(e, [S]), [])
})
