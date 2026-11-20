// UMG 细节面板按配置画：默认值、标默认、样式出处、插槽在最前。
// 用法：node --test ue/web/inspect/layouts/umg/edit/node-props.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { valueAt } from '../../../../../shared/forge-doc/edit.ts'
import { parseLocated } from '../../../../../shared/forge-doc/locate.ts'
import { nodeProps } from './node-props.ts'

const SAMPLE = `{
  // 示例界面
  "kind": "umg-widget",
  "root": {
    "class": "VerticalBox",
    "name": "Root",
    "children": [
      {"class":"TextBlock","name":"Title","props":{"Text":"AF","Font":{"Size":16,"TypefaceFontName":"Bold"}}},
      {
        "class": "Border",
        "name": "Card",
        "style": "Card",
        "props": {
          "BrushColor": {"R":0.1,"G":0.1,"B":0.1,"A":1}, // 卡片底色
          "Padding": "(Left=8,Top=8,Right=8,Bottom=8)",
        },
        "slot": {"Padding":{"Left":0,"Top":0,"Right":0,"Bottom":12}}
      }
    ]
  },
  "styles": { "Card": { "props": { "ContentColorAndOpacity": {"R":0.5,"G":0.5,"B":0.5,"A":1} } } }
}
`
const doc = () => parseLocated(SAMPLE).value

test('nodeProps：没写的显示 UE 默认值并标默认，样式给的标出处，插槽在最前', () => {
  const d = doc() as { styles: unknown }
  const title = nodeProps({
    node: valueAt(d, ['root', 'children', 0]),
    styles: d.styles,
    cls: 'TextBlock',
    parentClass: 'VerticalBox',
    fromStyle: (s) => `style:${s}`,
  })
  assert.equal(title.props[0].name, 'Slot.Padding')
  assert.equal(title.props[0].category, 'Slot (VerticalBoxSlot)')
  const font = title.props.find((p) => p.name === 'Font')!
  assert.deepEqual(font.value, {
    FontObject: '/Engine/EngineFonts/Roboto.Roboto',
    TypefaceFontName: 'Bold',
    Size: 16,
    LetterSpacing: 0,
    SkewAmount: 0,
  })
  assert.equal(font.members?.find((m) => m.name === 'FontObject')?.displayName, 'Font Family')
  assert.equal(title.isDefault('Font.Size'), false)
  assert.equal(title.isDefault('Font.LetterSpacing'), true)
  assert.equal(title.isChanged('Font.Size'), true)
  assert.equal(title.isChanged('Font.TypefaceFontName'), false)
  assert.equal(title.isDefault('Slot.Padding'), true)
  assert.deepEqual(title.defaultOf('ColorAndOpacity'), { R: 1, G: 1, B: 1, A: 1 })

  const card = nodeProps({
    node: valueAt(d, ['root', 'children', 1]),
    styles: d.styles,
    cls: 'Border',
    parentClass: 'VerticalBox',
    fromStyle: (s) => `style:${s}`,
  })
  assert.equal(card.props.find((p) => p.name === 'ContentColorAndOpacity')?.note, 'style:Card')
  assert.deepEqual(card.props.find((p) => p.name === 'Padding')?.value, { Left: 8, Top: 8, Right: 8, Bottom: 8 })
  assert.equal(card.isDefault('Padding.Left'), false)
  assert.equal(card.isChanged('ContentColorAndOpacity'), true)
})
