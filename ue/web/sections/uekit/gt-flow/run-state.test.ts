import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyFlowEvent, applyJob, emptyRun, guardTotal } from './run-state.ts'

test('节点进出、循环换轮、守护次数', () => {
  let s = emptyRun()
  s = applyFlowEvent(s, { runId: 'r1', phase: 'enter', id: 'loop1' })
  s = applyFlowEvent(s, { runId: 'r1', phase: 'iter', id: 'loop1', iter: 3 })
  s = applyFlowEvent(s, { runId: 'r1', phase: 'enter', id: 's2' })
  s = applyFlowEvent(s, { runId: 'r1', phase: 'leave', id: 's2', status: 'failed', ms: 120 })
  s = applyFlowEvent(s, { runId: 'r1', phase: 'guard', guard: 'g1' })
  assert.equal(s.at, 's2')
  assert.deepEqual(s.steps.loop1, { status: 'running', iter: 3, runs: 1 })
  assert.deepEqual(s.steps.s2, { status: 'failed', ms: 120, runs: 1 })
  assert.equal(s.guards.g1, 1)
  assert.equal(s.guardActive, 'g1')
  s = applyFlowEvent(s, { runId: 'r1', phase: 'guardEnd', guard: 'g1' })
  assert.equal(s.guardActive, undefined)
})

test('没有 id 的按路径，未知的状态当通过', () => {
  const s = applyFlowEvent(emptyRun(), { phase: 'leave', path: 'steps.0', status: 'weird' })
  assert.equal(s.steps['steps.0'].status, 'passed')
})

test('换了一次运行就清掉上一次的', () => {
  let s = applyFlowEvent(emptyRun(), { runId: 'a', phase: 'guard', guard: 'g1' })
  s = applyFlowEvent(s, { runId: 'b', phase: 'enter', id: 's1' })
  assert.deepEqual(s.guards, {})
  assert.deepEqual(Object.keys(s.steps), ['s1'])
})

test('gt.job 的守护次数为准；跑完收起运行态但留着结果', () => {
  let s = applyFlowEvent(emptyRun(), { runId: 'r', phase: 'enter', id: 's1' })
  s = applyFlowEvent(s, { runId: 'r', phase: 'pause', id: 's1', vars: { a: 1 } })
  s = applyJob(s, { runId: 'r', busy: true, at: 's1', guards: { g1: 5, g2: 1200 } })
  assert.equal(guardTotal(s), 1205)
  assert.equal(s.paused, true)
  s = applyJob(s, { runId: 'r', busy: false })
  assert.equal(s.active, false)
  assert.equal(s.paused, false)
  assert.equal(s.at, undefined)
  assert.equal(s.guards.g2, 1200)
  assert.equal(s.steps.s1.status, 'running')
})

test('循环里的步骤每进一次 runs +1，换一次运行清零', () => {
  let s = emptyRun()
  for (let i = 0; i < 3; i++) {
    s = applyFlowEvent(s, { runId: 'r', phase: 'enter', id: 's5' })
    s = applyFlowEvent(s, { runId: 'r', phase: 'leave', id: 's5', status: 'passed' })
  }
  assert.equal(s.steps.s5.runs, 3)
  s = applyFlowEvent(s, { runId: 'r2', phase: 'enter', id: 's5' })
  assert.equal(s.steps.s5.runs, 1)
})
