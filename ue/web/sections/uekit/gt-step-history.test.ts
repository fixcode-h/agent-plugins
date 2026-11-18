// 步骤在一次运行里的状态。用法：node --test ue/web/sections/uekit/gt-step-history.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stepMark } from './gt-step-history.ts'

const run = (o: { succeeded: boolean; failedStep?: number; failedPath?: string }) => ({ runId: 'r', ...o })
const top = (i: number) => ({ key: `steps.${i}`, slot: 'steps', i })

test('通过的运行里每步都算通过', () => {
  assert.equal(stepMark(run({ succeeded: true }), top(3)), 'p')
})

test('failedStep 从 1 数：第 4 步（下标 3）失败', () => {
  const r = run({ succeeded: false, failedStep: 4 })
  assert.equal(stepMark(r, top(3)), 'f')
  assert.equal(stepMark(r, top(2)), 'p')
  assert.equal(stepMark(r, top(4)), 'n')
})

test('前置步骤失败（failedStep 0）：场景里的步骤都没跑到', () => {
  assert.equal(stepMark(run({ succeeded: false, failedStep: 0 }), top(0)), 'n')
})

test('有 failedPath 按路径：段里的步骤、外面的段、后面的步骤', () => {
  const r = run({ succeeded: false, failedStep: 2, failedPath: 'steps.1.do.1' })
  const at = (key: string) => ({ key, slot: key.split('.').slice(0, -1).join('.'), i: Number(key.split('.').at(-1)) })
  assert.equal(stepMark(r, at('steps.1.do.1'), true), 'f')
  assert.equal(stepMark(r, at('steps.1'), true), 'f')
  assert.equal(stepMark(r, at('steps.1.do.0'), true), 'p')
  assert.equal(stepMark(r, at('steps.0'), true), 'p')
  assert.equal(stepMark(r, at('steps.1.do.2'), true), 'n')
  assert.equal(stepMark(r, at('steps.2'), true), 'n')
})

test('旧记录只有序号、场景里有块：对不上', () => {
  assert.equal(stepMark(run({ succeeded: false, failedStep: 2 }), top(1), true), 'u')
})
