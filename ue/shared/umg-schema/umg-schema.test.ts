// UMG 细节面板按配置改：原文最小改动（setJsonAt）、改什么（planEdit）、默认值和样式来源（nodeProps）。
// 用法：node --test ue/shared/umg-schema/umg-schema.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expandConfig, sourceOf } from '../forge-doc/include.ts'
import { setJsonAt, valueAt } from '../forge-doc/edit.ts'
import { parseLocated } from '../forge-doc/locate.ts'
import { umgPropDefs, umgSlotDefs } from './defaults.ts'
import { applyPlan, planEdit } from './node-edit.ts'

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

test('setJsonAt：只换那一个值，注释、缩进、别的字段一个字节不动', () => {
  const out = setJsonAt(SAMPLE, ['root', 'children', 0, 'props', 'Text'], '去商店')
  assert.equal(out, SAMPLE.replace('"Text":"AF"', '"Text":"去商店"'))
  // 字段名按导入规则认（大小写不敏感），写回沿用原文拼法
  const out2 = setJsonAt(SAMPLE, ['root', 'children', 0, 'props', 'font', 'size'], 18)
  assert.equal(out2, SAMPLE.replace('"Size":16', '"Size":18'))
})

test('setJsonAt：一行写完的对象接在后面，多行的另起一行跟缩进，缺的层补上', () => {
  const inline = setJsonAt(SAMPLE, ['root', 'children', 0, 'props', 'Font', 'LetterSpacing'], 2)
  assert.match(inline, /"TypefaceFontName":"Bold", "LetterSpacing": 2\}/)
  const multi = setJsonAt(SAMPLE, ['root', 'children', 1, 'props', 'RenderOpacity'], 0.5)
  assert.match(multi, /"Padding": "\(Left=8,Top=8,Right=8,Bottom=8\)",\n {10}"RenderOpacity": 0.5,\n/)
  const fresh = setJsonAt(SAMPLE, ['root', 'children', 0, 'slot', 'Padding', 'Left'], 4)
  assert.match(fresh, /"Size":16,"TypefaceFontName":"Bold"\}\}, "slot": \{ "Padding": \{ "Left": 4 \} \}\}/)
  for (const s of [inline, multi, fresh]) parseLocated(s)
})

test('setJsonAt：删字段带走逗号和整行，删空了往上删到节点为止', () => {
  const del = setJsonAt(SAMPLE, ['root', 'children', 1, 'props', 'BrushColor'], undefined, { pruneEmpty: 3 })
  assert.ok(!del.includes('BrushColor'))
  assert.ok(!del.includes('卡片底色'))
  assert.equal(
    valueAt(parseLocated(del).value, ['root', 'children', 1, 'props', 'Padding']),
    '(Left=8,Top=8,Right=8,Bottom=8)',
  )
  // Text 删了还有 Font；Font 两个成员都删了 → Font 没了；再删 Text → props 没了，节点还在
  let s = setJsonAt(SAMPLE, ['root', 'children', 0, 'props', 'Font', 'Size'], undefined, { pruneEmpty: 3 })
  s = setJsonAt(s, ['root', 'children', 0, 'props', 'Font', 'TypefaceFontName'], undefined, { pruneEmpty: 3 })
  assert.match(s, /"props":\{"Text":"AF"\}/)
  s = setJsonAt(s, ['root', 'children', 0, 'props', 'Text'], undefined, { pruneEmpty: 3 })
  assert.match(s, /\{"class":"TextBlock","name":"Title"\}/)
  parseLocated(s)
})

test('planEdit：改成默认值从配置删掉，不同才写；结构体只写那个成员', () => {
  const node = valueAt(doc(), ['root', 'children', 0])
  const defs = umgPropDefs('TextBlock')
  const base = { node, styles: undefined, defs, field: 'props' as const }
  assert.deepEqual(planEdit({ ...base, segs: ['Font', 'Size'], next: 24 }), {
    segs: ['Font', 'Size'],
    value: undefined,
  })
  assert.deepEqual(planEdit({ ...base, segs: ['Font', 'Size'], next: 30 }), { segs: ['Font', 'Size'], value: 30 })
  // 没写过、改成的又是默认值：不用动配置
  assert.equal(planEdit({ ...base, segs: ['AutoWrapText'], next: false }), null)
  assert.deepEqual(planEdit({ ...base, segs: ['AutoWrapText'], next: true }), { segs: ['AutoWrapText'], value: true })
  // FSlateColor 写回包成 SpecifiedColor
  assert.deepEqual(planEdit({ ...base, segs: ['ColorAndOpacity'], next: { R: 1, G: 0, B: 0, A: 1 } }), {
    segs: ['ColorAndOpacity'],
    value: { SpecifiedColor: { R: 1, G: 0, B: 0, A: 1 }, ColorUseRule: 'UseColor_Specified' },
  })
})

test('planEdit：整串写法整体重写；样式给的值改了写到节点上，改回样式的值删掉', () => {
  const d = doc() as { styles: unknown }
  const node = valueAt(d, ['root', 'children', 1])
  const base = { node, styles: d.styles, defs: umgPropDefs('Border'), field: 'props' as const }
  assert.deepEqual(planEdit({ ...base, segs: ['Padding', 'Top'], next: 4 }), {
    segs: ['Padding'],
    value: '(Left=8,Top=4,Right=8,Bottom=8)',
  })
  const gray = { R: 0.5, G: 0.5, B: 0.5, A: 1 }
  assert.equal(planEdit({ ...base, segs: ['ContentColorAndOpacity'], next: gray }), null)
  assert.deepEqual(planEdit({ ...base, segs: ['ContentColorAndOpacity'], next: { ...gray, R: 1 } }), {
    segs: ['ContentColorAndOpacity'],
    value: { ...gray, R: 1 },
  })
})

test('applyPlan：include 片段里的节点改片段文件，路径按 sourceOf 查', async () => {
  const files: Record<string, string> = {
    'umg/W.json':
      '{ "kind": "umg-widget", "root": { "class": "VerticalBox", "children": [ { "include": "W.parts/a.json" } ] } }',
    'umg/W.parts/a.json':
      '{\n  "fragment": "node",\n  "node": [\n    { "class": "TextBlock", "name": "A" },\n    { "class": "TextBlock", "name": "B", "props": { "Text": "b" } }\n  ]\n}\n',
  }
  const exp = await expandConfig('umg/W.json', async (f) => files[f])
  const src = sourceOf(exp, ['root', 'children', 1], 'umg/W.json')
  assert.deepEqual(src, { file: 'umg/W.parts/a.json', path: ['node', 1] })
  const out = applyPlan(files[src.file], src.path, 'props', { segs: ['Text'], value: 'B!' })
  assert.match(out, /"name": "B", "props": \{ "Text": "B!" \}/)
  const added = applyPlan(files[src.file], ['node', 0], 'slot', {
    segs: ['Padding'],
    value: { Left: 1, Top: 0, Right: 0, Bottom: 0 },
  })
  assert.match(added, /"name": "A", "slot": \{ "Padding": \{ "Left": 1, "Top": 0, "Right": 0, "Bottom": 0 \} \} \}/)
})

test('默认值表：插槽按父类认，认不得的父类没有插槽属性', () => {
  assert.deepEqual(
    umgSlotDefs('/Script/UMG.Overlay').map((d) => [d.name, d.def]),
    [
      ['Padding', { Left: 0, Top: 0, Right: 0, Bottom: 0 }],
      ['HorizontalAlignment', 'HAlign_Left'],
      ['VerticalAlignment', 'VAlign_Top'],
    ],
  )
  assert.deepEqual(umgSlotDefs('MyPanel'), [])
  assert.ok(umgPropDefs('Unknown').some((d) => d.name === 'Visibility'))
})
