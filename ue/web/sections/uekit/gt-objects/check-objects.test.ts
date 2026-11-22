import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GtScript } from '../../../../shared/gt-script/index.ts'
import { objCheckPlan, objCheckResult } from './check-objects.ts'

test('核对所有对象：命名对象和内联引用都问，找不到的对回用到它的步骤', () => {
  const doc = {
    objects: { 商店: { class: 'WBP_Shop_C' }, 背包: { class: 'WBP_Bag_C' } },
    steps: [
      { id: 'a', action: 'obj.call', obj: '商店', function: 'X' },
      { action: 'obj.find', obj: { class: 'BP_Hero_C' } },
      { id: 'c', action: 'click', target: { obj: '商店', part: 'Btn' } },
      { id: 'd', action: 'obj.call', obj: '$shop' },
    ],
  } as unknown as GtScript
  const plan = objCheckPlan(doc)
  assert.deepEqual(
    plan.refs.map((r) => r.id),
    ['商店', '背包', '#steps.1'],
  )
  assert.deepEqual(plan.users.get('商店'), ['a', 'c'])
  const r = objCheckResult(plan, [
    { id: '商店', count: 0 },
    { id: '背包', count: 1 },
    { id: '#steps.1', error: '类不存在' },
  ])
  assert.equal(r.found, 1)
  assert.deepEqual([...r.steps].sort(), ['a', 'c', 'steps.1'])
})
