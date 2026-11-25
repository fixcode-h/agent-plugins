// 自写的 .uasset 读取器（ue/docs/uasset-offline-reader.md）：用 test/pack.ts 拼的最小资源测，不带第三方资源文件。
// 用法：node --import ./scripts/lib/panel-register.mjs --test ue/shared/uasset/uasset.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assetDiff } from '../asset-diff/diff.ts'
import { readAsset } from './asset.ts'
import { UassetError } from './errors.ts'
import { prop } from './objects.ts'
import { fileSnapshot, rowsOf } from './snap.ts'
import { mergeLayer } from './inherit.ts'
import { columnKey, fillRow, learnColumns, normRow } from './table-defaults.ts'
import { buildPackage, v, writeTagged, type PropSpec } from './test/pack.ts'
import { dataAsset, dataAssetSpec, dataTable } from './test/samples.ts'

test('读数据资产：属性、结构体、数组、对象引用、子对象', () => {
  const a = readAsset(dataAsset())
  assert.equal(a.failed, 0)
  assert.equal(a.main?.name, 'DA_Sword')
  assert.equal(a.main?.class, 'ItemData')
  assert.equal(prop(a.main, 'Damage'), 42)
  assert.equal(prop(a.main, 'Title'), 'Sword')
  assert.equal(prop(a.main, 'Enabled'), true)
  assert.deepEqual(prop(a.main, 'Tags'), [1, 2, 3])
  assert.deepEqual(prop(a.main, 'Size'), { width: 5 })
  assert.equal(prop(a.main, 'Part'), '/Game/Data/DA_Sword.DA_Sword:Blade')
  const blade = a.byPath.get('/Game/Data/DA_Sword.DA_Sword:Blade')
  assert.equal(blade?.class, 'ItemPart')
  assert.equal(prop(blade, 'Weight'), 1.5)
  assert.deepEqual(a.pkg.registry[0].tags, { Rarity: 'Epic' })
})

test('读数据表的行', () => {
  const a = readAsset(dataTable())
  assert.equal(prop(a.main, 'RowStruct'), '/Script/Game.ItemRow')
  assert.deepEqual(rowsOf(a.main), [
    { Name: 'Apple', Price: 3, Label: 'apple' },
    { Name: 'Pear', Price: 5 },
  ])
})

test('烘焙过的包、更新的引擎版本、不是资源文件：报原因不硬读', () => {
  const kind = (buf: Uint8Array) => {
    try {
      readAsset(buf)
      return 'ok'
    } catch (e) {
      return e instanceof UassetError ? e.kind : 'other'
    }
  }
  assert.equal(kind(buildPackage({ ...dataAssetSpec(), flags: 0x80000000 })), 'cooked')
  assert.equal(kind(buildPackage({ ...dataAssetSpec(), ue5: 1019 })), 'newer')
  assert.equal(kind(buildPackage({ ...dataAssetSpec(), ue5: 1009 })), 'old')
  assert.equal(kind(new Uint8Array(64)), 'not-package')
})

test('两版快照比出改了的属性', () => {
  const d = assetDiff(fileSnapshot(dataAsset(42)), fileSnapshot(dataAsset(50)))
  const changed = d.defaults.props.filter((p) => p.change !== 'same')
  assert.deepEqual(
    changed.map((p) => [p.name, p.a, p.b]),
    [['Damage', 42, 50]],
  )
  assert.equal(d.stats.props, 1)
})

test('按二进制存的引擎结构：曲线关键帧数组、PerPlatform、InstancedStruct', () => {
  const key = (w: Parameters<NonNullable<PropSpec['value']>>[0], t: number, val: number) => {
    w.u8(2).u8(0).u8(0)
    for (const x of [t, val, 0, 0, 0, 0]) w.f32(x)
  }
  const a = readAsset(
    buildPackage({
      packageName: '/Game/Data/C_Speed',
      imports: [
        { classPackage: '/Script/CoreUObject', className: 'Package', outer: 0, name: '/Script/Engine' },
        { classPackage: '/Script/CoreUObject', className: 'Class', outer: -1, name: 'CurveFloat' },
        { classPackage: '/Script/CoreUObject', className: 'ScriptStruct', outer: -1, name: 'ItemRow' },
      ],
      exports: [
        {
          name: 'C_Speed',
          classIndex: -2,
          props: [
            {
              name: 'Keys',
              type: ['ArrayProperty', [['StructProperty', [['RichCurveKey'], ['/Script/Engine']]]]],
              value: (w) => {
                w.i32(2)
                key(w, 0, 1)
                key(w, 1, 2.5)
              },
            },
            {
              name: 'ScreenSize',
              type: ['StructProperty', [['PerPlatformFloat'], ['/Script/CoreUObject']]],
              binary: true,
              value: (w, n) => {
                w.i32(0).f32(0.5).i32(1)
                n.write(w, 'Mobile')
                w.f32(0.25)
              },
            },
            {
              name: 'Payload',
              type: ['StructProperty', [['InstancedStruct'], ['/Script/CoreUObject']]],
              binary: true,
              value: (w, n) => {
                w.i32(0xabababab | 0)
                  .u8(0)
                  .i32(-3)
                const sizeAt = w.pos
                w.i32(0)
                const start = w.pos
                writeTagged(w, n, [{ name: 'Price', type: ['IntProperty'], value: v.int(7) }])
                w.patch32(sizeAt, w.pos - start)
              },
            },
          ],
        },
      ],
    }),
  )
  assert.equal(a.failed, 0)
  const keys = prop(a.main, 'Keys') as { time: number; value: number; interpMode: string }[]
  assert.equal(keys.length, 2)
  assert.equal(keys[1].value, 2.5)
  assert.equal(keys[0].interpMode, 'RCIM_Cubic')
  assert.deepEqual(prop(a.main, 'ScreenSize'), { default: 0.5, perPlatform: { Mobile: 0.25 } })
  assert.deepEqual(prop(a.main, 'Payload'), { scriptStruct: '/Script/Engine.ItemRow', value: { price: 7 } })
})

test('原型链合并：结构体按成员合、静态数组合回一条、下层的 changed 不带上来', () => {
  const base = [
    { name: 'Body', value: { profile: 'BlockAll', mass: 1 } },
    { name: 'Slots', value: [0, 0, 0] },
    { name: 'Old', value: 1, changed: true },
  ]
  const own = [
    { name: 'Body', type: 'FBody', arrayIndex: 0, value: { mass: 3 } },
    { name: 'Slots', type: 'int32', arrayIndex: 2, value: 9 },
    { name: 'New', type: 'int32', arrayIndex: 0, value: 4 },
  ]
  const out = mergeLayer(base, own, (p) => ({ type: p.type }))
  assert.deepEqual(out, [
    { name: 'Body', value: { profile: 'BlockAll', mass: 3 }, changed: true },
    { name: 'Slots', value: [0, 0, 9], changed: true },
    { name: 'Old', value: 1 },
    { name: 'New', type: 'int32', value: 4, changed: true },
  ])
})

test('数据表默认值：编辑器读的表和文件里的行对出每列默认值，用户定义结构的列名去掉编号', () => {
  assert.equal(columnKey('Health_2_8A9B0C1D2E3F40516273849506172839'), 'Health')
  const file = new Map([
    ['A', normRow({ Name: 'A', Price_1_8A9B0C1D2E3F40516273849506172839: 3 })],
    [
      'B',
      normRow({ Name: 'B', Price_1_8A9B0C1D2E3F40516273849506172839: 4, Tag_3_8A9B0C1D2E3F40516273849506172839: 'x' }),
    ],
  ])
  const cols = learnColumns(
    {
      columns: [{ name: 'Price', type: 'int32' }, { name: 'Tag' }, { name: 'Pos', type: 'FVector' }],
      rows: [
        { name: 'A', values: { Price: 3, Tag: 'def', Pos: { x: 0, y: 0, z: 0 } } },
        { name: 'B', values: { Price: 4, Tag: 'x', Pos: { x: 0, y: 0, z: 0 } } },
      ],
    },
    file,
  )
  assert.deepEqual(
    cols.map((c) => [c.name, c.has, c.value]),
    [
      ['Price', false, undefined],
      ['Tag', true, 'def'],
      ['Pos', true, { x: 0, y: 0, z: 0 }],
    ],
  )
  assert.deepEqual(fillRow({ Price: 3, Pos: { y: 2 } }, cols), { Price: 3, Tag: 'def', Pos: { x: 0, y: 2, z: 0 } })
})
