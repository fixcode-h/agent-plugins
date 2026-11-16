/** 「AI 整理」的步骤差异和字段核对。用法：node --test ue/web/sections/uekit/gt-tidy-diff.test.ts */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkSteps, diffCounts, diffSteps, stepKey } from './gt-tidy-diff.ts'

test('note、hint 和字段顺序不算改动', () => {
  assert.equal(
    stepKey({ action: 'click', target: 'A', hint: { text: 'x' } }),
    stepKey({ target: 'A', note: '点 GM 入口', action: 'click' }),
  )
  assert.notEqual(stepKey({ action: 'click', target: 'A' }), stepKey({ action: 'click', target: 'B' }))
})

test('删掉重复点击和修饰键，补一步等待', () => {
  const a = [
    { action: 'pie.start' },
    { action: 'click', target: 'GM' },
    { action: 'key', key: 'LeftAlt', phase: 'press' },
    { action: 'click', target: 'GM' },
    { action: 'key', key: 'LeftAlt', phase: 'release' },
    { action: 'click', target: 'Item' },
  ]
  const b = [
    { action: 'pie.start', note: '开 PIE' },
    { action: 'click', target: 'GM', note: '打开 GM 面板' },
    { action: 'wait', until: 'widget', target: 'Item' },
    { action: 'click', target: 'Item', note: '点 GM 项' },
  ]
  const rows = diffSteps(a, b)
  assert.deepEqual(diffCounts(rows), { same: 3, del: 3, add: 1 })
  assert.deepEqual(
    rows.filter((r) => r.kind === 'same').map((r) => [r.a, r.b]),
    [
      [0, 0],
      [1, 1],
      [5, 3],
    ],
  )
})

test('对着 gt.actions 核对动作名和字段', () => {
  const catalog = {
    common: ['action', 'target', 'note', 'timeoutMs', 'onFail', 'hint'],
    actions: [
      { name: 'click', params: ['via', 'at', 'button'] },
      { name: 'key', params: ['key', 'phase'] },
    ],
  }
  assert.deepEqual(
    checkSteps(
      [
        { action: 'click', target: 'A', note: 'x' },
        { action: 'key', key: 'W', phase: 'tap', holdMs: 1200 },
        { action: 'tap', key: 'W' },
      ],
      catalog,
    ),
    ['#2 key: holdMs', '#3 action=tap'],
  )
})
