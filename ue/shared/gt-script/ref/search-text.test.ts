import assert from 'node:assert/strict'
import { test } from 'node:test'
import { searchText } from './search-text.ts'

test('Lua 模块搜索只比最后一段，带 . 或 / 时比整条路径', () => {
  const name = 'Module.Main.SM_HD_HomeDecoration.Spawner.lt_HD_DecorationSpawner'
  assert.equal(searchText(name, 'sm_hd'), 'lt_hd_decorationspawner')
  assert.ok(!searchText(name, 'sm_hd_homedecoration').includes('sm_hd_homedecoration'))
  assert.ok(searchText(name, 'homedecoration.spawner').includes('homedecoration.spawner'))
  assert.equal(searchText('BP_Hero_C', 'hero'), 'bp_hero_c')
})
