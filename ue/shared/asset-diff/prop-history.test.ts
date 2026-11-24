/** 属性来历：在快照里按对象找属性值；同一提交的资源路径换算；差异报告 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { packageOfRel } from '../../server/asset-diff/changeset.ts'
import { assetDiff } from './diff.ts'
import { propValueIn } from './prop-history.ts'
import { diffReport } from './report.ts'
import type { AssetSnap } from './types.ts'

const snap = (speed: number): AssetSnap => ({
  class: 'BP_Box_C',
  props: [{ name: 'Speed', value: speed }],
  blueprint: {
    parent: 'Actor',
    interfaces: [],
    variables: [],
    components: [
      { name: 'Mesh', class: 'StaticMeshComponent', parent: '', source: 'scs', props: [{ name: 'Mass', value: speed * 2 }] },
    ],
    graphs: [],
    widgets: [
      {
        name: 'Title',
        class: 'TextBlock',
        path: 'Root/Title',
        parent: 'Root',
        props: [{ name: 'Text', value: 'hi' }],
        slotClass: 'CanvasPanelSlot',
        slot: [{ name: 'ZOrder', value: speed }],
      },
    ],
  },
})

test('在快照里找类默认值、组件、控件插槽的属性', () => {
  const s = snap(3)
  assert.deepEqual(propValueIn(s, { kind: 'defaults', key: '', prop: 'Speed' }), { found: true, value: 3 })
  assert.deepEqual(propValueIn(s, { kind: 'component', key: 'Mesh', source: 'scs', prop: 'Mass' }), {
    found: true,
    value: 6,
  })
  assert.deepEqual(propValueIn(s, { kind: 'widget', key: 'Title', prop: 'Slot.ZOrder' }), { found: true, value: 3 })
  assert.deepEqual(propValueIn(s, { kind: 'component', key: 'Nope', prop: 'Mass' }), { found: false })
  assert.deepEqual(propValueIn(null, { kind: 'defaults', key: '', prop: 'Speed' }), { found: false })
})

test('提交里的文件换成包路径：项目 Content、插件 Content，别的不算', () => {
  assert.equal(packageOfRel('Content/Maps/Lvl.umap'), '/Game/Maps/Lvl')
  assert.equal(packageOfRel('Content\\BP\\A.uasset'), '/Game/BP/A')
  assert.equal(packageOfRel('Plugins/Foo/Content/UI/W.uasset'), '/Foo/UI/W')
  assert.equal(packageOfRel('Source/Game/A.cpp'), '')
  assert.equal(packageOfRel('Other/Content/A.uasset'), '')
})

test('差异报告列出改了的属性', () => {
  const d = assetDiff(snap(1), snap(2))
  const md = diffReport('/Game/BP_Box', '#1', '#2', d)
  assert.match(md, /# \/Game\/BP_Box 的改动：#1 → #2/)
  assert.match(md, /`Speed`.*1 → 2/)
  assert.match(md, /组件 Mesh/)
})
