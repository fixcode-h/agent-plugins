import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { setHost } from '../../../host.ts'
import { applyPreset, presetFor } from './state-presets.ts'

// 文案原样返回：只测分路的结构
setHost({ t: (zh: string) => zh } as unknown as Parameters<typeof setHost>[0])

test('按控件种类挑默认分法', () => {
  const w = { obj: 'w' }
  assert.equal(presetFor(w, 'button').id, 'click')
  assert.equal(presetFor(w, 'check').id, 'checked')
  assert.equal(presetFor(w, 'text').id, 'text')
  assert.equal(presetFor(w, 'other').id, 'shown')
  assert.equal(presetFor(w).id, 'shown')
})

test('按它分路：画成按状态分支，不丢原来的步骤', () => {
  const step: GtStep = {
    action: 'if',
    id: 'if1',
    cond: { obj: 'x', prop: ':shown', op: 'is', value: true },
    then: [{ action: 'click', target: 'A' }],
    else: [{ action: 'wait', ms: 500 }],
  }
  const out = applyPreset(step, presetFor({ obj: 'guide', part: 'BtnFinish' }, 'button'))
  assert.equal(out.branch, 'state')
  assert.deepEqual(out.cond, { obj: 'guide', prop: '@BtnFinish:enabled', op: 'is', value: true })
  assert.deepEqual(out.then, [{ action: 'click', target: 'A' }])
  assert.equal((out.elif as unknown[]).length, 1)
  assert.deepEqual(out.else, [{ action: 'wait', ms: 500 }])
  assert.equal(out.id, 'if1')
})
