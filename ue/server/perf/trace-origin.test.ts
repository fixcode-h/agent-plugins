import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shiftArgs, shiftResult } from './trace-origin.ts'

test('请求里的时间加上 origin，回包里的减掉', () => {
  assert.deepEqual(shiftArgs({ what: 'timing', t0: 1, t1: '2', lanes: [1] }, 1700), {
    what: 'timing',
    t0: 1701,
    t1: 1702,
    lanes: [1],
  })
  assert.deepEqual(shiftArgs({ what: 'timers', t0: undefined }, 1700), { what: 'timers', t0: undefined })
  const f = shiftResult('frames', { analyzing: true, duration: 1731, start: [1700, 1700.5], ms: [16, 17] }, 1700)
  assert.deepEqual(f, { analyzing: true, duration: 31, start: [0, 0.5], ms: [16, 17] })
  const tm = shiftResult('timing', { duration: 1710, lanes: [{ id: 1, s: [1701], ms: [3] }] }, 1700)
  assert.deepEqual(tm.lanes, [{ id: 1, s: [1], ms: [3] }])
  assert.deepEqual(shiftResult('log', { duration: 1710, items: [{ t: 1705, m: 'x' }] }, 1700).items, [{ t: 5, m: 'x' }])
})

test('旧桥接没有 origin：原样返回', () => {
  const r = { duration: 31, start: [0.1] }
  assert.deepEqual(shiftResult('frames', r, 0), r)
})
