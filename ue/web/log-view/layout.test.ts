// 日志列表的多行布局（layout.ts）。用法（在 ue/ 下）：node --test web/log-view/layout.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutRows, lineCount, MAX_ENTRY_LINES, visibleRange } from './layout.ts'

test('多行记录按行数占高度，分隔行占一行', () => {
  const { tops, total } = layoutRows([{ text: 'a' }, { text: 'b\nc\nd' }, { text: '', mark: true }, { text: 'e' }], 20)
  assert.deepEqual(tops, [0, 20, 80, 100])
  assert.equal(total, 120)
})

test('只画视口里的几条，跨过上沿的那条也画', () => {
  const { tops, total } = layoutRows(
    Array.from({ length: 100 }, (_, i) => ({ text: i === 10 ? 'x\n'.repeat(9) + 'x' : 'x' })),
    20,
  )
  // 第 10 条从 200 到 400；视口从 300 开始，第 10 条要画
  assert.deepEqual(visibleRange(tops, total, 300, 100, 0), { first: 10, last: 11 })
  assert.deepEqual(visibleRange(tops, total, 300, 150, 0), { first: 10, last: 14 })
  assert.deepEqual(visibleRange(tops, total, 0, 0, 0), { first: 0, last: 1 })
  assert.deepEqual(visibleRange([], 0, 0, 400, 200), { first: 0, last: 0 })
})

test('一条超长的最多算 MAX_ENTRY_LINES 行', () => {
  assert.equal(lineCount('x\n'.repeat(2000)), MAX_ENTRY_LINES)
})
