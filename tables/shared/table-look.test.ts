import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rowAfter, shiftLook } from './table-look.ts'

test('rowAfter：插行后面的往下挪，删掉的行给 -1', () => {
  const ops = [
    { at: 2, n: 1 },
    { at: 5, n: -2 },
  ]
  assert.equal(rowAfter(0, ops), 0)
  assert.equal(rowAfter(2, ops), 3)
  // 原第 4 行插行后在第 5 行，被删掉
  assert.equal(rowAfter(4, ops), -1)
  assert.equal(rowAfter(9, ops), 8)
})

test('shiftLook：批注、链接、底色、合并区跟着没保存的插删行挪', () => {
  const look = {
    merges: [{ r: 0, c: 0, rows: 1, cols: 3 }],
    notes: [
      { r: 3, c: 1, text: 'a' },
      { r: 6, c: 0, text: 'b' },
    ],
    links: [{ r: 6, c: 2, url: 'https://example.com' }],
    fills: [{ r: 3, color: '#ffff00' }],
  }
  const out = shiftLook(look, [
    { at: 1, n: 2 },
    { at: 5, n: -1 },
  ])!
  assert.deepEqual(out.merges, [{ r: 0, c: 0, rows: 1, cols: 3 }])
  // 原第 3 行插两行后在第 5 行，被删掉；原第 6 行 → 8 → 7
  assert.deepEqual(out.notes, [{ r: 7, c: 0, text: 'b' }])
  assert.deepEqual(out.links, [{ r: 7, c: 2, url: 'https://example.com' }])
  assert.deepEqual(out.fills, [])
  assert.equal(shiftLook(look, []), look)
})
