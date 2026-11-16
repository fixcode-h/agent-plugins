import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DOUBLE_SHIFT_MS, doubleShift } from './keys.ts'

const shift = { key: 'Shift' }

test('两次 Shift 间隔够短算双击，算过之后重新数', () => {
  const s = doubleShift()
  assert.equal(s(shift, 1000), false)
  assert.equal(s(shift, 1000 + DOUBLE_SHIFT_MS - 10), true)
  assert.equal(s(shift, 1000 + DOUBLE_SHIFT_MS + 20), false)
})

test('间隔太长不算', () => {
  const s = doubleShift()
  s(shift, 0)
  assert.equal(s(shift, DOUBLE_SHIFT_MS + 1), false)
})

test('中间按了别的键（Shift+字母打大写）不算', () => {
  const s = doubleShift()
  s(shift, 0)
  assert.equal(s({ key: 'A' }, 50), false)
  assert.equal(s(shift, 100), false)
})

test('按住不放的自动重复不算', () => {
  const s = doubleShift()
  s(shift, 0)
  assert.equal(s({ key: 'Shift', repeat: true }, 30), false)
  assert.equal(s({ key: 'Shift', repeat: true }, 60), false)
})
