import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyKey, fieldsOfCond, keyOf, type StepKey } from './gt-key.ts'

const key: StepKey = {
  from: 'WBP_Bag:Root/ItemList[6]',
  base: 'WBP_Bag:Root/ItemList',
  pos: 'WBP_Bag:Root/ItemList[6]',
  by: 'pending',
}

test('applyKey 把前缀换成按标识的写法，后面的路径不动', () => {
  const r = applyKey('WBP_Bag:Root/ItemList[6]>BtnUse', key, 'Data.ItemId=1001')
  assert.deepEqual(r, {
    target: 'WBP_Bag:Root/ItemList[Data.ItemId=1001]>BtnUse',
    from: 'WBP_Bag:Root/ItemList[Data.ItemId=1001]',
  })
})

test('applyKey 条件空 = 按位置', () => {
  const k = { ...key, from: 'WBP_Bag:Root/ItemList[Data.ItemId=1001]' }
  assert.equal(
    applyKey('WBP_Bag:Root/ItemList[Data.ItemId=1001]>BtnUse', k, '')?.target,
    'WBP_Bag:Root/ItemList[6]>BtnUse',
  )
})

test('applyKey target 被手改过对不上前缀时不改', () => {
  assert.equal(applyKey('WBP_Other:Root/Btn', key, 'Data.ItemId=1'), undefined)
})

test('fieldsOfCond 取条件左边', () => {
  assert.deepEqual(fieldsOfCond('Data.ItemId=1001, @lua.Slot=3'), ['Data.ItemId', '@lua.Slot'])
})

test('keyOf 只认带 from 的 key', () => {
  assert.equal(keyOf({ key: { by: 'auto' } }), undefined)
  assert.equal(keyOf({ key }), key)
})
