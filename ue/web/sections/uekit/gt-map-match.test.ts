// 「打开地图」地图输入框的候选。用法：node --test ue/web/sections/uekit/gt-map-match.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toAsset, type LoadedIndex } from '../../jump/index-match.ts'
import { matchKeys } from './gt-blocks/fields/key-names.ts'
import { matchMaps } from './gt-map-match.ts'

const idx: LoadedIndex = {
  version: '1',
  assets: [
    toAsset(['/Game/Maps/Lobby.Lobby', 'World']),
    toAsset(['/Game/Maps/Battle/Arena.Arena', 'World']),
    toAsset(['/Game/Maps/MapIcon.MapIcon', 'Texture2D']),
    toAsset(['/Game/UI/WBP_Map.WBP_Map', 'WidgetBlueprint', 'UserWidget']),
  ],
  lua: [],
  source: { assets: 'uetovs', lua: 'none' },
}

test('只列关卡（World），填包路径', () => {
  const r = matchMaps(idx, '', 50)
  assert.deepEqual(
    r.rows.map((x) => x.pkg),
    ['/Game/Maps/Battle/Arena', '/Game/Maps/Lobby'],
  )
  assert.equal(r.all, 2)
})

test('按名字搜', () => {
  assert.deepEqual(
    matchMaps(idx, 'lob', 50).rows.map((x) => x.name),
    ['Lobby'],
  )
  assert.equal(matchMaps(undefined, 'lob', 50).total, 0)
})

test('键名候选含手柄键，按包含筛', () => {
  const r = matchKeys('dpad')
  assert.equal(r.total, 4)
  assert.ok(r.rows.every((k) => k.group === 'gamepad'))
  assert.ok(matchKeys('').total > 60)
})
