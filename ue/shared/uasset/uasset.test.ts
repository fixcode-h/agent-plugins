// 自写的 .uasset 读取器（ue/docs/uasset-offline-reader.md）：用 test/pack.ts 拼的最小资源测，不带第三方资源文件。
// 用法：node --import ./scripts/lib/panel-register.mjs --test ue/shared/uasset/uasset.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assetDiff } from '../asset-diff/diff.ts'
import { readAsset } from './asset.ts'
import { UassetError } from './errors.ts'
import { prop } from './objects.ts'
import { fileSnapshot, rowsOf } from './snap.ts'
import { buildPackage } from './test/pack.ts'
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
