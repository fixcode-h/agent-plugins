import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyKey, fieldsOfCond, filterKeys, keyOf, type StepKey } from './gt-key.ts'

const key: StepKey = {
  from: 'WBP_Bag:Root/ItemList[6]',
  base: 'WBP_Bag:Root/ItemList',
  pos: 'WBP_Bag:Root/ItemList[6]',
  by: 'pending',
}

test('applyKey 把前缀换成按标识的写法，后面的路径不动', () => {
  const r = applyKey('WBP_Bag:Root/ItemList[6]>BtnUse', key, '@item.ItemId=1001')
  assert.deepEqual(r, {
    target: 'WBP_Bag:Root/ItemList[@item.ItemId=1001]>BtnUse',
    from: 'WBP_Bag:Root/ItemList[@item.ItemId=1001]',
  })
})

test('applyKey 条件空 = 按位置', () => {
  const k = { ...key, from: 'WBP_Bag:Root/ItemList[@item.ItemId=1001]' }
  assert.equal(
    applyKey('WBP_Bag:Root/ItemList[@item.ItemId=1001]>BtnUse', k, '')?.target,
    'WBP_Bag:Root/ItemList[6]>BtnUse',
  )
})

test('applyKey target 被手改过对不上前缀时不改', () => {
  assert.equal(applyKey('WBP_Other:Root/Btn', key, '@item.ItemId=1'), undefined)
})

test('fieldsOfCond 取条件左边', () => {
  assert.deepEqual(fieldsOfCond('@item.ItemId=1001, @#Slot=3'), ['@item.ItemId', '@#Slot'])
})

test('keyOf 只认带 from 的 key', () => {
  assert.equal(keyOf({ key: { by: 'auto' } }), undefined)
  assert.equal(keyOf({ key }), key)
})

test('filterKeys 按字段名或值筛、丢掉空组', () => {
  const data = {
    total: 3,
    count: 3,
    groups: [
      {
        source: 'item',
        title: '数据',
        fields: [
          { by: '@item.ItemId', v: 1001 },
          { by: '@item.Name', v: 'Sword' },
        ],
      },
      { source: 'self', title: '控件', fields: [{ by: '@.bSelected', v: false }] },
    ],
  }
  const r = filterKeys(data, 'sword')
  assert.equal(r.total, 1)
  assert.equal(r.groups.length, 1)
  assert.equal(r.groups[0].fields[0].by, '@item.Name')
  assert.equal(filterKeys(data, 'itemid').groups[0].fields[0].v, 1001)
  assert.equal(filterKeys(data, ' ').total, 3)
})
