// 标记视图的模型：节点 → 标签、值压成一行、颜色、关键帧、按段、片段标记。
// 用法：node --test ue/web/sections/uekit/forge-markup/markup.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HEAD, sectionIds } from '../../../../shared/forge-doc/index.ts'
import { buildSections, colorOf, inline } from './markup.ts'

const DOC = {
  '//': '说明',
  kind: 'umg-widget',
  asset: '/Game/UI/WBP_Shop',
  revision: 7,
  styles: { NavButton: { props: { IsFocusable: false }, slot: { Padding: { Left: 8, Top: 0, Right: 8, Bottom: 0 } } } },
  root: {
    class: 'Overlay',
    name: 'Root',
    children: [
      {
        class: 'Button',
        name: 'Go',
        style: 'NavButton',
        isVariable: true,
        props: { BackgroundColor: { R: 1, G: 0, B: 0, A: 1 } },
      },
      { ref: 'pages/Shop', name: 'Shop' },
    ],
  },
  animations: [
    {
      name: 'PageIn',
      tracks: [
        { target: 'Root/Go', channel: 'RenderOpacity', keys: [[0, 0], { time: 0.3, value: 0.85, interp: 'cubic' }] },
      ],
    },
  ],
}

test('按段出标签：头、样式、控件树、动画', () => {
  const s = buildSections(DOC, sectionIds(undefined, 'umg-widget'))
  assert.deepEqual(
    s.map((x) => x.id),
    [HEAD, 'styles', 'root', 'animations'],
  )
  const head = s[0].nodes[0]
  assert.equal(head.note, '说明')
  assert.deepEqual(
    head.attrs.map((a) => `${a.name}=${a.text}`),
    ['Kind=umg-widget', 'Path=/Game/UI/WBP_Shop', 'Revision=7'],
  )
  const style = s[1].nodes[0]
  assert.deepEqual(
    style.attrs.map((a) => `${a.name}=${a.text}`),
    ['Name=NavButton', 'IsFocusable=false', 'Slot.Padding=8, 0, 8, 0'],
  )
  const root = s[2].nodes[0]
  const go = root.children[0]
  assert.equal(go.tag, 'Button')
  assert.deepEqual(
    go.attrs.map((a) => a.name),
    ['Name', 'Style', 'isVariable', 'BackgroundColor'],
  )
  assert.equal(go.attrs[2].flag, true)
  assert.equal(go.attrs[3].swatch, 'rgba(255, 0, 0, 1)')
  assert.deepEqual(go.path, ['root', 'children', 0])
  assert.equal(root.children[1].tag, 'SubWidget')
  assert.equal(root.children[1].attrs.find((a) => a.name === 'Ref')?.text, 'pages/Shop')
  const track = s[3].nodes[0].children[0]
  assert.equal(track.attrs.find((a) => a.name === 'Keys')?.text, '0→0 · 0.3→0.85 cubic')
})

test('值压成一行', () => {
  assert.equal(inline({ X: 1, Y: 2 }), '(1, 2)')
  assert.equal(inline({ Size: 16, TypefaceFontName: 'Bold' }), '{Size=16 TypefaceFontName=Bold}')
  assert.equal(
    colorOf({ SpecifiedColor: { R: 0, G: 0, B: 0 }, ColorUseRule: 'UseColor_Specified' })?.text,
    '0, 0, 0, 1',
  )
  assert.equal(colorOf({ R: 1, G: 1 }), undefined)
})

test('片段来的节点和段标出来', () => {
  const s = buildSections(DOC, sectionIds(undefined, 'umg-widget'), (p) =>
    p[0] === 'animations' ? 'W.parts/anim.json' : p.length === 3 && p[2] === 1 ? 'W.parts/shop.json' : undefined,
  )
  assert.equal(s.find((x) => x.id === 'animations')?.fragment, 'W.parts/anim.json')
  assert.equal(s.find((x) => x.id === 'animations')?.nodes[0].fragment, undefined)
  assert.equal(s.find((x) => x.id === 'root')?.nodes[0].children[1].fragment, 'W.parts/shop.json')
})
