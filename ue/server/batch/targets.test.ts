// select 的面板侧筛选（旧 UELink 不认 paths / name / exclude 时靠它）和逐个列出的上限。
// 用法（在仓库根）：node --test ue/server/batch/targets.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_LIST_MAX, itemsFromJson, keep, tooMany, wildcard } from './select-filter.ts'

test('通配符和 UE 的 MatchesWildcard 一样：* ? 不分大小写，点号按字面', () => {
  assert.ok(wildcard('BP_Goblin_Boss', '*_boss'))
  assert.ok(wildcard('BP_A1', 'bp_a?'))
  assert.ok(!wildcard('BP_A12', 'BP_A?'))
  assert.ok(!wildcard('BPxBoss', 'BP.Boss'))
})

test('目录、名字、排除组合筛', () => {
  const a = { path: '/Game/Enemies/BP_Orc.BP_Orc', name: 'BP_Orc', package: '/Game/Enemies/BP_Orc' }
  const old = { path: '/Game/Enemies/Legacy/BP_Orc_Old.BP_Orc_Old', name: 'BP_Orc_Old' }
  assert.ok(keep(a, ['/Game/Enemies'], [], []))
  assert.ok(!keep(a, ['/Game/Heroes', '/Game/NPC/'], [], []))
  assert.ok(!keep(old, [], [], ['*_Old']))
  assert.ok(!keep(old, [], [], ['/Game/Enemies/Legacy/*']))
  assert.ok(keep(a, [], ['BP_Orc*'], ['*_Old']))
  assert.ok(!keep(a, [], ['*_Boss'], []))
  // 目录比对按整段：/Game/Enemies 不包含 /Game/EnemiesExtra
  assert.ok(!keep({ path: '/Game/EnemiesExtra/X.X', name: 'X' }, ['/Game/Enemies'], [], []))
})

test('paths / items 逐个列出超过上限时拦下，让改用 select；上限可改、不合法时用默认值', () => {
  assert.equal(tooMany(DEFAULT_LIST_MAX, 'paths', NaN), undefined)
  assert.match(tooMany(DEFAULT_LIST_MAX + 1, 'items', NaN) ?? '', /没有执行.*改用 select/)
  assert.equal(tooMany(80, 'paths', 100), undefined)
  assert.match(tooMany(101, 'paths', 100) ?? '', /最多 100 个/)
})

test('itemsFile 的内容：数组、{items}、一行一个对象都认，缺 path 报第几项', () => {
  assert.deepEqual(itemsFromJson('[{"path":"/Game/A","value":1}]'), [{ path: '/Game/A', value: 1 }])
  assert.equal((itemsFromJson('\uFEFF{"items":[{"path":"/Game/A"},{"path":"/Game/B"}]}') as unknown[]).length, 2)
  assert.equal((itemsFromJson('{"path":"/Game/A"}\n{"path":"/Game/B"}\n') as unknown[]).length, 2)
  assert.match(String(itemsFromJson('[{"path":"/Game/A"},{"value":1}]')), /第 2 项没有 path/)
  assert.match(String(itemsFromJson('')), /空/)
})
