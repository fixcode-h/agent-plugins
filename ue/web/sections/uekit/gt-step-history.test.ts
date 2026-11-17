// 步骤在一次运行里的状态。用法：node --test ue/web/sections/uekit/gt-step-history.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stepMark } from './gt-step-history.ts'

const run = (o: { succeeded: boolean; failedStep?: number }) => ({ runId: 'r', ...o })

test('通过的运行里每步都算通过', () => {
  assert.equal(stepMark(run({ succeeded: true }), 3), 'p')
})

test('failedStep 从 1 数：第 4 步（下标 3）失败', () => {
  const r = run({ succeeded: false, failedStep: 4 })
  assert.equal(stepMark(r, 3), 'f')
  assert.equal(stepMark(r, 2), 'p')
  assert.equal(stepMark(r, 4), 'n')
})

test('前置步骤失败（failedStep 0）：场景里的步骤都没跑到', () => {
  assert.equal(stepMark(run({ succeeded: false, failedStep: 0 }), 0), 'n')
})
