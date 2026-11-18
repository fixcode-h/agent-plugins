// 选择器按树拆分。用法：node --test ue/web/sections/uekit/gt-selector-tree.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectorTree } from './gt-selector-tree.ts'

test('屏、路径、嵌套 WBP、按位置的段', () => {
  const n = selectorTree('WBP_Main:Canvas/#UMG_Item_C#1>Root/Btn')
  assert.deepEqual(
    n.map((x) => [x.text, x.depth, x.kind, x.index]),
    [
      ['WBP_Main', 0, 'screen', undefined],
      ['Canvas', 1, 'path', undefined],
      ['#UMG_Item_C#1', 2, 'path', 1],
      ['Root', 3, 'hop', undefined],
      ['Btn', 4, 'path', undefined],
    ],
  )
})

test('方括号里的 / 和 > 不切，>> 之后是 Slate', () => {
  const n = selectorTree('WBP_Bag:List[Path=/Game/A>B]/X>>STableRow[text=高]/STextBlock')
  assert.deepEqual(
    n.map((x) => x.text),
    ['WBP_Bag', 'List[Path=/Game/A>B]', 'X', 'STableRow[text=高]', 'STextBlock'],
  )
  assert.equal(n[3].kind, 'slate')
  assert.equal(selectorTree('Root/Items[2]>Btn')[1].index, 2)
})

test('句柄原样', () => {
  assert.deepEqual(selectorTree('@btn'), [{ text: '@btn', depth: 0, kind: 'path' }])
})

test('整个界面 WBP_X:. 只显示界面名，不出孤零零的点', async () => {
  const { wholeScreenOf } = await import('./gt-selector-tree.ts')
  assert.equal(wholeScreenOf('WBP_ForgeSample:.'), 'WBP_ForgeSample')
  assert.equal(wholeScreenOf('WBP_A:Root/Btn'), undefined)
  assert.equal(wholeScreenOf('WBP_A:Root>.'), undefined)
  assert.deepEqual(
    selectorTree('WBP_ForgeSample:.').map((x) => [x.text, x.kind]),
    [['WBP_ForgeSample', 'screen']],
  )
})
