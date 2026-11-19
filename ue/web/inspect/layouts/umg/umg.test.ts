// UMG 布局纯逻辑的单测：node --test ue/web/inspect/layouts/umg/umg.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hitTest, layoutTree, marginOf, sizeRule, withSlotAnims, type Rect } from './approx.ts'
import { configKind, fromConfig, parseUmgConfig, type CfgNode } from './config.ts'
import { fromDesign, indexTree, resolveTarget } from './model.ts'
import { cssColor, paintOf, transformOf } from './paint.ts'

const at = (rects: Rect[], key: string) => {
  const r = rects.find((x) => x.key === key)
  assert.ok(r, `没有 ${key}`)
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }
}

test('配置带注释也能解析，kind 和节点树', () => {
  const text = `{
    // 注释
    "kind": "umg-widget", "asset": "/Game/UI/WBP_A",
    "root": { "class": "/Script/UMG.Overlay", "name": "Root", "children": [
      { "class": "TextBlock", "name": "Title", "props": { "Text": "a // 不是注释", "Visibility": "Collapsed" } },
      { "name": "Page", "ref": "./pages/P.json" } ] }
  }`
  assert.equal(configKind(text), 'umg-widget')
  const doc = parseUmgConfig(text)!
  assert.equal((doc.root!.children![0].props as { Text: string }).Text, 'a // 不是注释')
  const root = fromConfig(doc.root!)
  assert.equal(root.cls, 'Overlay')
  assert.equal(root.children[0].key, 'Root/Title')
  assert.equal(root.children[0].visibility, 'Collapsed')
  assert.equal(root.children[1].user, true)
  assert.equal(root.children[1].cls, 'UserWidget')
  assert.equal(parseUmgConfig('{坏的'), undefined)
})

test('UE 回的设计时控件树：key 按名字拼，插槽类、变量', () => {
  const root = fromDesign({
    name: 'Root',
    class: '/Script/UMG.CanvasPanel',
    path: '/Game/W.W:WidgetTree.Root',
    children: [
      {
        name: 'Go',
        class: 'Button',
        path: '/Game/W.W:WidgetTree.Go',
        var: true,
        slot: 'CanvasPanelSlot',
        children: [],
      },
    ],
  })
  const idx = indexTree(root)
  assert.equal(idx.byKey.get('Root/Go')?.slotClass, 'CanvasPanelSlot')
  assert.equal(resolveTarget(idx, 'Go')?.key, 'Root/Go')
  assert.equal(resolveTarget(idx, 'Root/Go')?.isVar, true)
})

test('横排：Auto 按期望大小，Fill 分剩下的；边距不参与分配', () => {
  const cfg: CfgNode = {
    class: 'HorizontalBox',
    name: 'Row',
    children: [
      { class: 'SizeBox', name: 'Side', props: { bOverride_WidthOverride: true, WidthOverride: 200 } },
      {
        class: 'Border',
        name: 'Main',
        slot: { Size: { SizeRule: 'Fill', Value: 1 }, Padding: { Left: 10, Top: 0, Right: 10, Bottom: 0 } },
      },
      { class: 'Spacer', name: 'Gap', props: { Size: { X: 50, Y: 1 } } },
    ],
  }
  const rects = layoutTree(fromConfig(cfg), 1000, 500)
  assert.deepEqual(at(rects, 'Row/Side'), { x: 0, y: 0, w: 200, h: 500 })
  // 1000 - 200 - 50 - 20（边距）= 730
  assert.deepEqual(at(rects, 'Row/Main'), { x: 210, y: 0, w: 730, h: 500 })
  assert.deepEqual(at(rects, 'Row/Gap'), { x: 950, y: 0, w: 50, h: 500 })
})

test('叠放按插槽对齐；Collapsed 不排；WidgetSwitcher 只排当前页', () => {
  const cfg: CfgNode = {
    class: 'Overlay',
    name: 'Root',
    children: [
      {
        class: 'Spacer',
        name: 'C',
        props: { Size: { X: 100, Y: 40 } },
        slot: { HorizontalAlignment: 'HAlign_Center', VerticalAlignment: 'VAlign_Bottom' },
      },
      { class: 'Spacer', name: 'Gone', props: { Size: { X: 10, Y: 10 }, Visibility: 'Collapsed' } },
      {
        class: 'WidgetSwitcher',
        name: 'Pages',
        props: { ActiveWidgetIndex: 1 },
        slot: { HorizontalAlignment: 'HAlign_Fill', VerticalAlignment: 'VAlign_Fill' },
        children: [
          { class: 'Border', name: 'P0' },
          { class: 'Border', name: 'P1' },
        ],
      },
    ],
  }
  const rects = layoutTree(fromConfig(cfg), 800, 600)
  assert.deepEqual(at(rects, 'Root/C'), { x: 350, y: 560, w: 100, h: 40 })
  assert.ok(!rects.some((r) => r.key === 'Root/Gone'))
  assert.ok(!rects.some((r) => r.key === 'Root/Pages/P0'))
  assert.deepEqual(at(rects, 'Root/Pages/P1'), { x: 0, y: 0, w: 800, h: 600 })
})

test('Border 的内边距和内容对齐；CanvasPanel 的锚点偏移', () => {
  const cfg: CfgNode = {
    class: 'CanvasPanel',
    name: 'Root',
    children: [
      {
        class: 'Border',
        name: 'Card',
        slot: {
          LayoutData: {
            Offsets: { Left: 20, Top: 30, Right: 300, Bottom: 100 },
            Anchors: { Minimum: { X: 0, Y: 0 }, Maximum: { X: 0, Y: 0 } },
          },
        },
        props: { Padding: 10, HorizontalAlignment: 'HAlign_Right', VerticalAlignment: 'VAlign_Top' },
        children: [{ class: 'Spacer', name: 'Dot', props: { Size: { X: 8, Y: 8 } } }],
      },
      {
        class: 'Border',
        name: 'Bar',
        slot: {
          LayoutData: {
            Offsets: { Left: 0, Top: 0, Right: 0, Bottom: 50 },
            Anchors: { Minimum: { X: 0, Y: 1 }, Maximum: { X: 1, Y: 1 } },
            Alignment: { X: 0, Y: 1 },
          },
        },
      },
    ],
  }
  const rects = layoutTree(fromConfig(cfg), 1000, 500)
  assert.deepEqual(at(rects, 'Root/Card'), { x: 20, y: 30, w: 300, h: 100 })
  assert.deepEqual(at(rects, 'Root/Card/Dot'), { x: 302, y: 40, w: 8, h: 8 })
  assert.deepEqual(at(rects, 'Root/Bar'), { x: 0, y: 450, w: 1000, h: 50 })
})

test('点预览选控件：取包含这个点的最小矩形', () => {
  const rects = [
    { key: 'a', x: 0, y: 0, w: 100, h: 100 },
    { key: 'b', x: 10, y: 10, w: 50, h: 50 },
    { key: 'c', x: 70, y: 70, w: 10, h: 10 },
  ]
  assert.equal(hitTest(rects, 20, 20)?.key, 'b')
  assert.equal(hitTest(rects, 75, 75)?.key, 'c')
  assert.equal(hitTest(rects, 90, 5)?.key, 'a')
  assert.equal(hitTest(rects, 200, 5), undefined)
})

test('边距和 Size 的几种写法；动画里的插槽边距进排版', () => {
  assert.deepEqual(marginOf(4), { l: 4, t: 4, r: 4, b: 4 })
  assert.deepEqual(marginOf('(Left=1,Top=2,Right=3,Bottom=4)'), { l: 1, t: 2, r: 3, b: 4 })
  assert.deepEqual(sizeRule({ Size: 'Fill' }), { fill: true, value: 1 })
  assert.deepEqual(sizeRule(undefined), { fill: false, value: 1 })
  const root = fromConfig({
    class: 'VerticalBox',
    name: 'V',
    children: [{ class: 'Spacer', name: 'S', slot: { Padding: { Left: 0, Top: 5, Right: 0, Bottom: 0 } } }],
  })
  const moved = withSlotAnims(root, new Map([['V/S', { 'slot.Padding.Left': 40 }]]))
  assert.deepEqual(moved.children[0].slot?.Padding, { Left: 40, Top: 5, Right: 0, Bottom: 0 })
  assert.equal(withSlotAnims(root, new Map()), root)
})

test('近似预览的颜色、文字和渲染变换', () => {
  assert.equal(cssColor({ R: 1, G: 0, B: 0, A: 0.5 }), 'rgba(255, 0, 0, 0.5)')
  assert.equal(
    cssColor({ SpecifiedColor: { R: 0, G: 0, B: 1, A: 1 }, ColorUseRule: 'UseColor_Specified' }),
    'rgba(0, 0, 255, 1)',
  )
  assert.equal(cssColor('red'), undefined)
  const text = paintOf(
    fromConfig({
      class: 'TextBlock',
      name: 'T',
      props: { Text: '你好', Font: { Size: 18, TypefaceFontName: 'Bold' } },
    }),
  )
  assert.equal(text.text, '你好')
  assert.equal(text.fontSize, 18)
  assert.equal(text.bold, true)
  const n = fromConfig({ class: 'Border', name: 'B', props: { RenderOpacity: 0.5 } })
  assert.deepEqual(transformOf(n), { transform: undefined, opacity: 0.5 })
  assert.deepEqual(transformOf(n, { 'RenderTransform.Translation.X': 60, RenderOpacity: 1 }), {
    transform: 'translate(60px, 0px) rotate(0deg) scale(1, 1)',
    opacity: undefined,
  })
})
