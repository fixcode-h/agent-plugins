import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planListEdits } from './gt-key-batch.ts'
import type { StepKey } from './gt-key.ts'

const base = 'W:Root/List'
const step = (i: number, text: string, changed: boolean) => {
  const from = `${base}/#Item#${i}`
  const key: StepKey = {
    from,
    base,
    pos: from,
    entry: 'Item',
    by: 'auto',
    cands: [{ by: '@text', cond: `@text=${text}`, src: 'text', v: text, hits: 1, unique: true, changed }],
  }
  return { action: 'click', target: `${from}>Button`, hint: { key } }
}

test('planListEdits 跳过那一步点完会变的字段', () => {
  const steps = [step(0, 'A', false), step(1, 'B', true), step(2, 'C', false)]
  const self = steps[0].hint.key
  const r = planListEdits(steps, 0, self, { mode: 'key', fields: ['@text'] })
  assert.deepEqual(
    r.edits.map((e) => e.index),
    [2],
  )
  assert.deepEqual(r.skipped, [1])
  assert.equal(r.edits[0].step.target, `${base}[@text=C]>Button`)
})
