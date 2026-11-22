import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepTryArgs, stepTryFromReport, stepTryOf } from './step-try.ts'

const step = { action: 'obj.call', obj: '商店', function: 'Buy' }

test('只做这一步带上 objects、vars 和参数默认值（没默认值的不传）', () => {
  const doc = {
    kind: 'GameTestScenario',
    schemaVersion: 5,
    name: 's',
    steps: [step],
    vars: { n: 1 },
    params: { id: { default: 2003 }, who: { type: 'string' } },
    objects: { 商店: { class: 'WBP_Shop' } },
  }
  assert.deepEqual(stepTryArgs(doc as never, step as never), {
    step,
    vars: { n: 1 },
    params: { id: 2003 },
    objects: { 商店: { class: 'WBP_Shop' } },
  })
  assert.deepEqual(stepTryArgs({ steps: [] } as never, step as never), { step })
})

test('同步步骤当场出结果；要等几帧的标 pending；成败看 succeeded / status，不看顶层 ok', () => {
  const done = stepTryOf(
    ['steps', 0],
    { ok: true, finished: true, runId: 'r1', succeeded: true, status: 'succeeded', payload: { invoke: {} } },
    Date.now(),
    1,
  )
  assert.equal(done.ok, true)
  assert.equal(done.pending, undefined)
  const wait = stepTryOf(['steps', 0], { ok: false, finished: false, runId: 'r2' }, Date.now(), 2)
  assert.equal(wait.pending, true)
  assert.equal(wait.ok, false)
  const bad = stepTryOf(
    ['steps', 0],
    { ok: true, finished: true, succeeded: false, status: 'failed', message: '找不到' },
    Date.now(),
    3,
  )
  assert.equal(bad.ok, false)
  assert.equal(bad.message, '找不到')
})

test('临时运行跑完：有失败取失败那条，块取块结束那条', () => {
  const prev = stepTryOf(['steps', 0], { finished: false, runId: 'r' }, Date.now(), 1)
  const fail = stepTryFromReport(prev, [
    { index: 0, action: 'click', status: 'succeeded', durationMs: 10 },
    { index: 1, action: 'wait', status: 'failed', message: '超时', durationMs: 5, payload: { evidence: {} } },
    { index: 0, action: 'group', status: 'failed', block: true },
  ])
  assert.equal(fail.ok, false)
  assert.equal(fail.message, '超时')
  assert.equal(fail.pending, undefined)
  assert.equal(fail.ms, 15)
  const ok = stepTryFromReport(prev, [
    { index: 0, action: 'click', status: 'succeeded' },
    { index: 0, action: 'group', status: 'succeeded', block: true, payload: { vars: { a: 1 } } },
  ])
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.payload, { vars: { a: 1 } })
})
