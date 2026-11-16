// 跳转本地索引的筛选和排序。用法：node --test ue/web/jump/index-match.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchAssets, matchLua, queryTerms, toAsset, toLua, type LoadedIndex } from './index-match.ts'

const idx: LoadedIndex = {
  version: '1',
  assets: [
    toAsset(['/Game/Characters/BP_HeroBase.BP_HeroBase', 'Blueprint', 'Character']),
    toAsset(['/Game/Characters/BP_Hero.BP_Hero', 'Blueprint', 'BP_HeroBase']),
    toAsset(['/Game/Data/DT_Items.DT_Items', '']),
    toAsset(['/Game/UI/Hero/WBP_Bag.WBP_Bag', 'WidgetBlueprint', 'UserWidget']),
    toAsset(['/Game/Maps/SuperHero.SuperHero', 'World']),
  ],
  lua: [toLua(['UI.BagPanel', 'D:/P/Content/Script/UI/BagPanel.lua'])],
  source: { assets: 'uetovs', lua: 'uetovs' },
}
const names = (q: string) => matchAssets(idx, queryTerms(q), 10).rows.map((r) => r.name)

test('名字完全一样 < 开头 < 中间 < 只有路径里有', () => {
  assert.deepEqual(names('bp_hero'), ['BP_Hero', 'BP_HeroBase'])
  assert.deepEqual(names('hero'), ['BP_Hero', 'SuperHero', 'BP_HeroBase', 'WBP_Bag'])
})

test('多个词都要有，路径里的也算', () => {
  assert.deepEqual(names('hero bag'), ['WBP_Bag'])
  assert.deepEqual(names('ui/hero'), ['WBP_Bag'])
})

test('贴磁盘路径、/Game 路径、对象路径、引用都能直接命中', () => {
  assert.deepEqual(names('D:\\Proj\\Content\\Data\\DT_Items.uasset'), ['DT_Items'])
  assert.deepEqual(names('/Game/Data/DT_Items'), ['DT_Items'])
  assert.deepEqual(names('/Game/Data/DT_Items.DT_Items'), ['DT_Items'])
  assert.equal(names('BP_Hero.BP_Hero_C')[0], 'BP_Hero')
})

test('超过上限只给前几条，total 是全部', () => {
  const m = matchAssets(idx, queryTerms('e'), 2)
  assert.equal(m.rows.length, 2)
  assert.equal(m.total, 5)
})

test('Lua 模块名点和斜杠两种写法都认', () => {
  assert.equal(matchLua(idx, queryTerms('bagpanel'), 5).total, 1)
  assert.equal(matchLua(idx, queryTerms('ui/bag'), 5).total, 1)
  assert.equal(matchLua(idx, queryTerms('ui.bag'), 5).total, 1)
})

test('5 万条资源筛一次在几十毫秒内', () => {
  const big: LoadedIndex = {
    ...idx,
    assets: Array.from({ length: 50000 }, (_, i) => toAsset([`/Game/F${i % 300}/SM_Rock_${i}.SM_Rock_${i}`, ''])),
  }
  const t0 = performance.now()
  const m = matchAssets(big, queryTerms('rock_4999'), 12)
  const ms = performance.now() - t0
  assert.equal(m.rows[0].name, 'SM_Rock_4999')
  assert.ok(ms < 200, `${ms}ms`)
})
