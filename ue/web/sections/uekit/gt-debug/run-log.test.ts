import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyLog, clock, emptyLog, LOG_MAX } from './run-log.ts'

test('进出补结果、循环换轮、守护里的步骤缩进', () => {
  let l = emptyLog()
  l = applyLog(l, { runId: 'r1', phase: 'enter', id: 'a', path: 'steps.0' }, 1000)
  l = applyLog(l, { runId: 'r1', phase: 'leave', id: 'a', path: 'steps.0', status: 'passed', ms: 20 }, 1020)
  l = applyLog(l, { runId: 'r1', phase: 'enter', id: 'loop', path: 'steps.1' }, 1100)
  l = applyLog(l, { runId: 'r1', phase: 'iter', id: 'loop', path: 'steps.1', iter: 2 }, 1200)
  l = applyLog(l, { runId: 'r1', phase: 'guard', guard: 'g1' }, 1300)
  l = applyLog(l, { runId: 'r1', phase: 'enter', id: 'g1s', path: 'steps.1.do.0' }, 1310)
  l = applyLog(l, { runId: 'r1', phase: 'guardEnd', guard: 'g1', ms: 50 }, 1350)
  l = applyLog(l, { runId: 'r1', phase: 'pause', id: 'b', path: 'steps.2' }, 2000)
  assert.deepEqual(
    l.entries.map((e) => [e.kind, e.key, e.status, e.depth]),
    [
      ['step', 'a', 'passed', 0],
      ['step', 'loop', 'running', 0],
      ['iter', 'loop', undefined, 0],
      ['guard', 'g1', 'passed', 0],
      ['step', 'g1s', 'running', 2],
      ['pause', 'b', undefined, 0],
    ],
  )
  assert.equal(l.entries[0].ms, 20)
  assert.equal(l.entries[5].at, 1000)
})

test('新的一次运行清掉旧记录，记录有上限', () => {
  let l = applyLog(emptyLog(), { runId: 'r1', phase: 'enter', id: 'a' }, 0)
  l = applyLog(l, { runId: 'r2', phase: 'enter', id: 'b' }, 5)
  assert.deepEqual(
    l.entries.map((e) => e.key),
    ['b'],
  )
  for (let i = 0; i < LOG_MAX + 10; i++) l = applyLog(l, { runId: 'r2', phase: 'iter', id: 'x', iter: i }, i)
  assert.equal(l.entries.length, LOG_MAX)
  assert.equal(clock(65_400), '1:05')
})

test('附带 GM：外面包的那层不记，每条附带 GM 缩在步骤下面，出错只记一笔的是 warned', () => {
  let l = applyLog(emptyLog(), { runId: 'r', phase: 'enter', path: 'steps.0#hooks' }, 0)
  l = applyLog(l, { runId: 'r', phase: 'enter', id: 'a', path: 'steps.0' }, 1)
  l = applyLog(l, { runId: 'r', phase: 'leave', id: 'a', path: 'steps.0', status: 'passed' }, 2)
  l = applyLog(l, { runId: 'r', phase: 'enter', path: 'steps.0.hooks.after.0' }, 3)
  l = applyLog(l, { runId: 'r', phase: 'leave', path: 'steps.0.hooks.after.0', status: 'warned' }, 4)
  l = applyLog(l, { runId: 'r', phase: 'leave', path: 'steps.0#hooks', status: 'passed' }, 5)
  assert.deepEqual(
    l.entries.map((e) => [e.key, e.status, e.depth]),
    [
      ['a', 'passed', 0],
      ['steps.0.hooks.after.0', 'warned', 1],
    ],
  )
})
