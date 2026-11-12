/** 插删列（含撤销重做）以后，本机按列号记的隐藏、冻结、列宽、筛选排序跟着挪 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { colDelta, shiftFilters, shiftLayout, shiftWidths } from './col-shift'

test('colDelta：新做的照做，撤销的反着做，对不上的不挪', () => {
  const a = { at: 1, n: 1 }
  const b = { at: 3, n: -2 }
  assert.deepEqual(colDelta([], [a]), [a])
  assert.deepEqual(colDelta([a], [a, b]), [b])
  assert.deepEqual(colDelta([a, b], [a]), [{ at: 3, n: 2 }])
  assert.deepEqual(colDelta([a, b], []), [
    { at: 3, n: 2 },
    { at: 1, n: -1 },
  ])
  assert.equal(colDelta([a], [b]), null)
})

test('插一列：后面的隐藏列、冻结、列宽、筛选排序都往后挪；删掉的列一起去掉', () => {
  const ins = [{ at: 1, n: 1 }]
  assert.deepEqual(shiftLayout({ freeze: 2, hidden: [0, 3] }, ins), { freeze: 3, hidden: [0, 4] })
  assert.deepEqual(shiftWidths({ 0: 80, 2: 120 }, ins), { 0: 80, 3: 120 })
  const del = [{ at: 1, n: -1 }]
  assert.deepEqual(shiftLayout({ freeze: 2, hidden: [1, 3] }, del), { freeze: 1, hidden: [2] })
  const f = shiftFilters({ 1: { values: ['a'] } as never, 2: { values: ['b'] } as never }, { col: 2, desc: true }, del)
  assert.deepEqual(Object.keys(f.filters), ['1'])
  assert.deepEqual(f.sort, { col: 1, desc: true })
  assert.equal(shiftFilters({}, { col: 1, desc: false }, del).sort, null)
})
