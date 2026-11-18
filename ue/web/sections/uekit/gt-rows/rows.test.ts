// 场景详情页的步骤行。用法：node scripts/test.mjs ue web/sections/uekit/gt-rows/rows.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { numOf, placeRows, resultKey, runStart } from './rows.ts'

const doc = [
  { action: 'pie.start' },
  {
    action: 'group',
    name: '录制段',
    do: [
      { action: 'click', target: 'A' },
      { action: 'if', cond: {}, then: [{ action: 'key' }], else: [{ action: 'wait' }] },
    ],
  },
  { action: 'key', key: 'Escape' },
]

describe('placeRows', () => {
  it('块里的步骤按路径各占一行，序号带上外层', () => {
    const rows = placeRows(doc)
    assert.deepEqual(
      rows.map((r) => [r.key, r.no, r.depth, r.slot, r.i]),
      [
        ['steps.0', '1', 0, 'steps', 0],
        ['steps.1', '2', 0, 'steps', 1],
        ['steps.1.do.0', '2.1', 1, 'steps.1.do', 0],
        ['steps.1.do.1', '2.2', 1, 'steps.1.do', 1],
        ['steps.1.do.1.then.0', '2.2.1', 2, 'steps.1.do.1.then', 0],
        ['steps.1.do.1.else.0', '2.2.2', 2, 'steps.1.do.1.else', 0],
        ['steps.2', '3', 0, 'steps', 2],
      ],
    )
    assert.equal(rows[1].block, true)
    assert.equal(rows[0].block, undefined)
  })
})

describe('resultKey', () => {
  it('有 path 按路径，没有按顶层序号', () => {
    assert.equal(resultKey({ index: 0, path: 'steps.1.do.0' }), 'steps.1.do.0')
    assert.equal(resultKey({ index: 2 }), 'steps.2')
    assert.equal(resultKey({ index: 0, setup: true }), undefined)
  })
  it('从顶层第 n 步起的临时运行加上 n；只跑一步的换成那一步的路径', () => {
    assert.equal(resultKey({ index: 0, path: 'steps.0.do.1' }, 1), 'steps.1.do.1')
    assert.equal(resultKey({ index: 1 }, 2), 'steps.3')
    assert.equal(resultKey({ index: 0, path: 'steps.0' }, 'steps.1.do.0'), 'steps.1.do.0')
  })
})

describe('runStart', () => {
  it('顶层给序号，块里给路径', () => {
    assert.deepEqual(runStart('steps.2'), { index: 2 })
    assert.deepEqual(runStart('steps.1.do.0'), { from: 'steps.1.do.0' })
  })
})

describe('collectTargets', () => {
  it('段里的选择器也收，按行的路径记', async () => {
    const { collectTargets } = await import('./check.ts')
    assert.deepEqual(
      collectTargets(doc).map((x) => [x.key, x.field, x.target]),
      [['steps.1.do.0', 'target', 'A']],
    )
  })
})

describe('numOf', () => {
  it('同一槽里别的步骤的序号', () => {
    assert.equal(numOf({ i: 3, no: '4' })(0), '1')
    assert.equal(numOf({ i: 0, no: '2.2.2' })(1), '2.2.3')
  })
})
