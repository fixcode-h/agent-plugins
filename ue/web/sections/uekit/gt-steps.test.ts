// 按位置写的选择器识别。用法：node --test ue/web/sections/uekit/gt-steps.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPositional } from './gt-steps.ts'

test('认出按位置写的段', () => {
  assert.equal(isPositional('WBP_GM:Root/History/#WBP_HistoryBtn_C#2>Btn'), true)
  assert.equal(isPositional('WBP_GM:Root/History/#WBP_HistoryBtn_C#2'), true)
  assert.equal(isPositional('WBP_Bag:Root/ItemList[2]>BtnUse'), true)
  assert.equal(isPositional('#WBP_Btn_C#0'), true)
})

test('名字、属性匹配、按类不带序号的不算', () => {
  assert.equal(isPositional('WBP_MainMenu:Root/Menu/BtnStart'), false)
  assert.equal(isPositional('WBP_Bag:Root/ItemList[ItemId=1001]>BtnUse'), false)
  assert.equal(isPositional('WBP_Bag:Root/#WBP_Item_C'), false)
  assert.equal(isPositional(undefined), false)
})
