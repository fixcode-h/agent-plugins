/** 按配置预览的属性：分类查表、插槽在最前、颜色和 UE 文本格式的结构体整理成细节面板能画色块的样子 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { categoryOf, normalizeValue, previewProps } from './forge-preview-props.ts'

test('插槽属性在最前，分类写成 Slot (父类Slot)，其余按 UE 细节面板的分类顺序', () => {
  const ps = previewProps(
    {
      class: 'TextBlock',
      props: { Visibility: 'Visible', Font: { Size: 16 }, Text: 'AF', AutoWrapText: true },
      slot: { Padding: 4 },
    },
    '/Script/UMG.HorizontalBox',
    '只读',
  )
  assert.deepEqual(
    ps.map((p) => [p.name, p.category]),
    [
      ['Slot.Padding', 'Slot (HorizontalBoxSlot)'],
      ['Text', 'Content'],
      ['Font', 'Appearance'],
      ['AutoWrapText', 'Wrapping'],
      ['Visibility', 'Behavior'],
    ],
  )
  assert.equal(ps[0].displayName, 'Padding')
  assert.ok(ps.every((p) => p.readOnly && p.edit))
  assert.equal(ps.find((p) => p.name === 'AutoWrapText')?.type, 'bool')
})

test('同名属性按类分：SizeBox 的 MinDesiredWidth 在 Child Layout，查不到的归 Default', () => {
  assert.equal(categoryOf('SizeBox', 'MinDesiredWidth'), 'Child Layout')
  assert.equal(categoryOf('TextBlock', 'MinDesiredWidth'), 'Appearance')
  assert.equal(categoryOf('MyWidget_C', 'Whatever'), 'Default')
})

test('FSlateColor 取里面的颜色，UE 文本格式的结构体拆成对象', () => {
  assert.deepEqual(normalizeValue({ SpecifiedColor: { R: 1, G: 0, B: 0, A: 1 }, ColorUseRule: 'UseColor_Specified' }), {
    R: 1,
    G: 0,
    B: 0,
    A: 1,
  })
  assert.deepEqual(normalizeValue('(X=1.5,Y=-2)'), { X: 1.5, Y: -2 })
  assert.equal(normalizeValue('HAlign_Fill'), 'HAlign_Fill')
})
