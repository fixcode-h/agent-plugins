// 「整理成流程」对着录制段里的步骤做（gt-tidy-scope.ts）。用法：node --test ue/server/uekit/gt-tidy-scope.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tidyScope } from './gt-tidy-scope.ts'

const seg = (id: string, n: number) => ({
  id,
  action: 'group',
  recorded: true,
  name: '录制',
  do: Array.from({ length: n }, (_, i) => ({ id: `${id}_${i}`, action: 'click', target: `W:B${i}` })),
})

test('顶层只有 pie.start + 一个录制段：自动整理段内步骤，写回只换段的 do', () => {
  const doc = { steps: [{ id: 'pie', action: 'pie.start' }, seg('rec1', 3)] }
  const s = tidyScope(doc)
  assert.equal(s.segment, 'rec1')
  assert.equal(s.steps.length, 3)
  const next = s.put([{ action: 'click', target: 'W:B0' }])
  assert.equal(next[0].action, 'pie.start')
  assert.equal((next[1] as { name: string }).name, '录制')
  assert.equal((next[1] as { do: unknown[] }).do.length, 1)
  // 原对象不动
  assert.equal((doc.steps[1] as { do: unknown[] }).do.length, 3)
})

test('指定段 id：嵌在别的块里的也找得到', () => {
  const doc = {
    steps: [{ id: 'g', action: 'group', do: [{ id: 'x', action: 'wait' }, seg('rec2', 2)] }, seg('rec3', 1)],
  }
  const s = tidyScope(doc, 'rec2')
  assert.equal(s.steps.length, 2)
  const next = s.put([])
  const inner = (next[0] as { do: { do?: unknown[] }[] }).do[1]
  assert.deepEqual(inner.do, [])
})

test('多个录制段或手写步骤：不自动认段，整理顶层', () => {
  const doc = { steps: [seg('a', 1), seg('b', 1)] }
  assert.equal(tidyScope(doc).segment, undefined)
  assert.equal(tidyScope({ steps: [{ action: 'click' }, seg('c', 2)] }).steps.length, 2)
  assert.throws(() => tidyScope(doc, 'nope'), /没有步骤段 nope/)
})
