/** 控件蓝图的控件树、动画差异：控件按名字配对、插槽属性并进同一张表、挪父控件算一处改动 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assetDiff, diffEmpty } from './diff.ts'
import type { AssetSnap, SnapWidget } from './types.ts'

const w = (name: string, parent: string, props: Record<string, unknown> = {}, slot?: Record<string, unknown>): SnapWidget => ({
  name,
  class: name.startsWith('Txt') ? 'TextBlock' : 'Image',
  path: parent ? `${parent}/${name}` : name,
  parent,
  props: Object.entries(props).map(([k, v]) => ({ name: k, category: '外观', value: v })),
  ...(slot && { slotClass: 'CanvasPanelSlot', slot: Object.entries(slot).map(([k, v]) => ({ name: k, value: v })) }),
})

const wbp = (widgets: SnapWidget[], keys: [number, number][]): AssetSnap => ({
  class: 'WidgetBlueprint',
  props: [],
  blueprint: {
    parent: '/Script/UMG.UserWidget',
    interfaces: [],
    variables: [],
    components: [],
    graphs: [],
    widgets,
    anims: [{ name: 'FadeIn', length: 0.5, channels: [{ target: 'Root/Img_Bg', channel: 'RenderOpacity', keys }] }],
  },
})

test('控件增删、插槽改动、挪父控件', () => {
  const a = wbp(
    [w('Root', ''), w('Img_Bg', 'Root', { ColorAndOpacity: 1 }, { Offsets: [0, 0, 320, 64] }), w('Txt_Desc', 'Root')],
    [[0, 0], [0.5, 1]],
  )
  const b = wbp(
    [
      w('Root', ''),
      w('HBox', 'Root'),
      w('Img_Bg', 'Root/HBox', { ColorAndOpacity: 0.8 }, { Offsets: [0, 0, 360, 72] }),
    ],
    [[0, 0], [0.4, 1]],
  )
  const d = assetDiff(a, b)
  assert.equal(d.stats.widgetAdd, 1)
  assert.equal(d.stats.widgetDel, 1)
  const bg = d.widgets.find((x) => x.key === 'Img_Bg')!
  assert.equal(bg.change, 'mod')
  assert.equal(bg.parent, 'HBox')
  const changed = bg.props.filter((p) => p.change !== 'same').map((p) => p.name).sort()
  assert.deepEqual(changed, ['ColorAndOpacity', 'ParentWidget', 'Slot.Offsets'])
  assert.equal(bg.props.find((p) => p.name === 'Slot.Offsets')!.category, '插槽（CanvasPanelSlot）')
  assert.equal(d.stats.anims, 1)
  assert.equal(d.anims[0].channels[0].change, 'mod')
})

test('没变的控件蓝图算没变；旧快照没有 widgets 字段时不出控件树', () => {
  const s = wbp([w('Root', '')], [[0, 0]])
  assert.ok(diffEmpty(assetDiff(s, s)))
  const old = { ...s, blueprint: { ...s.blueprint!, widgets: undefined, anims: undefined } }
  assert.deepEqual(assetDiff(old, old).widgets, [])
})
