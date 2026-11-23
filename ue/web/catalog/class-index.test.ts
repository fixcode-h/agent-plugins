import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GtClassRow } from '../../shared/gt-script/index.ts'
import { ancestors, buildIndex, searchIndex, SEARCH_MAX } from './class-index-model.ts'

const meta = { v: 'x', source: 'ue' as const }

test('行建成父子表：子类按名字排、算好 kids，父类不在表里的挂到最顶层', () => {
  const rows: GtClassRow[] = [
    ['Object', '', 'object', '', 0],
    ['Widget', 'Object', 'umg', '', 0],
    ['UserWidget', 'Widget', 'umg', '', 0],
    ['W_Shop', 'UserWidget', 'umg', '/Game/UI/W_Shop', 1],
    ['W_Bag', 'UserWidget', 'umg', '/Game/UI/W_Bag', 0],
    ['Orphan', 'NotLoaded', 'object', '', 0],
  ]
  const ix = buildIndex(rows, meta, false)
  assert.deepEqual(
    ix.kids.get('UserWidget')?.map((x) => x.name),
    ['W_Bag', 'W_Shop'],
  )
  assert.equal(ix.byName.get('UserWidget')?.kids, 2)
  assert.equal(ix.byName.get('W_Shop')?.asset, '/Game/UI/W_Shop')
  assert.equal(ix.byName.get('W_Shop')?.live, 1)
  assert.deepEqual(
    ix.kids.get('')?.map((x) => x.name),
    ['Object', 'Orphan'],
  )
  assert.deepEqual(ancestors(ix, 'W_Shop'), ['UserWidget', 'Widget', 'Object'])
  assert.deepEqual(ancestors(ix, 'W_Shop', 'Widget'), ['UserWidget', 'Widget'])
})

test('Lua 按目录：子目录带模块数，搜索只比最后一段（q 带 . 或 / 时比整条）', () => {
  const rows: GtClassRow[] = [
    ['UI.Shop.ShopPanel', '', 'lua', 'a.lua', 0],
    ['UI.Shop.ShopItem', 'UI.Shop.ShopPanel', 'lua', 'b.lua', 0],
    ['UI.Bag', '', 'lua', 'c.lua', 0],
    ['Game.Shop', '', 'lua', 'd.lua', 0],
  ]
  const ix = buildIndex(rows, meta, true)
  assert.deepEqual(ix.dirs.get('')?.subs, [
    { name: 'Game', count: 1 },
    { name: 'UI', count: 3 },
  ])
  assert.deepEqual(ix.dirs.get('UI')?.subs, [{ name: 'UI/Shop', count: 2 }])
  assert.deepEqual(
    ix.dirs.get('UI')?.mods.map((x) => x.name),
    ['UI.Bag'],
  )
  assert.equal(ix.byName.get('UI.Shop.ShopItem')?.file, 'b.lua')
  // 目录名 Shop 对上不算，只比最后一段；开头对上的排前面
  assert.deepEqual(
    searchIndex(ix, 'shop').hits.map((x) => x.name),
    ['Game.Shop', 'UI.Shop.ShopItem', 'UI.Shop.ShopPanel'],
  )
  assert.deepEqual(
    searchIndex(ix, 'ui.shop').hits.map((x) => x.name),
    ['UI.Shop.ShopItem', 'UI.Shop.ShopPanel'],
  )
  // 完全一样的排最前
  assert.equal(searchIndex(ix, 'shopitem').hits[0].name, 'UI.Shop.ShopItem')
  // 空格分开的几个词都要含
  assert.deepEqual(
    searchIndex(ix, 'shop item').hits.map((x) => x.name),
    ['UI.Shop.ShopItem'],
  )
})

test('上万个类：建索引和每次打字的搜索都够快（大项目硬要求）', () => {
  const rows: GtClassRow[] = [['Object', '', 'object', '', 0]]
  for (let i = 0; i < 30000; i++) {
    const parent = i < 300 ? 'Object' : `Class_${i % 300}`
    rows.push([`Class_${i}`, parent, i % 3 ? 'object' : 'actor', i % 2 ? `/Game/BP/Class_${i}` : '', i % 7])
  }
  let t0 = performance.now()
  const ix = buildIndex(rows, meta, false)
  const build = performance.now() - t0
  t0 = performance.now()
  // 一个字母命中几乎全部：只列前 SEARCH_MAX 个，总数照实
  const all = searchIndex(ix, 'c')
  for (const q of ['cl', 'cla', 'class_1', 'class_12', 'class_123']) searchIndex(ix, q)
  const per = (performance.now() - t0) / 6
  assert.equal(all.total, 30001)
  assert.equal(all.hits.length, SEARCH_MAX)
  assert.ok(build < 400, `建索引 ${build.toFixed(0)}ms`)
  assert.ok(per < 30, `每次搜索 ${per.toFixed(1)}ms`)
})
