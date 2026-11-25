// ue_gm action=call 的临时定义：对象按对象列表现找、内联匹配规则、来源字符串、按字段推断 kind。
// 用法：node scripts/test.mjs ue server/gm-custom/adhoc.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GmObject } from '../../shared/gm/schema.ts'
import { adhocDef } from './adhoc.ts'

const lib: GmObject[] = [
  { name: '背包', ref: { class: 'lua:Game.Bag', ident: [{ prop: '@#owner', op: 'eq', value: 1 }] }, folder: 'Agent' },
  { name: '玩家', src: '@pawn', folder: 'Agent' },
]

test('obj 写对象列表里的名字：对象和对象参数都从列表复制，记下是列表里的对象', () => {
  const { gm, libObj } = adhocDef({ obj: '背包', function: 'Give', args: { To: { $obj: '玩家' }, Id: 1 } }, lib)
  assert.equal(gm.kind, 'call')
  assert.equal(libObj, '背包')
  assert.deepEqual(gm.objects['背包'], { ref: lib[0].ref })
  assert.deepEqual(gm.objects['玩家'], { src: '@pawn' })
})

test('按字段推断 kind：prop → set（value 可以写在 def 上），props → get', () => {
  const set = adhocDef({ obj: '背包', prop: '@#gold', value: 999 }, lib).gm
  assert.equal(set.kind, 'set')
  assert.equal(set.args.value, 999)
  assert.equal(adhocDef({ obj: '背包', props: ['@#gold'] }, lib).gm.kind, 'get')
})

test('obj 写匹配规则或来源字符串：不用进对象列表，也不记调用记录', () => {
  const r = adhocDef({ obj: { class: 'lua:Game.Shop' }, function: 'Open' }, lib)
  assert.equal(r.libObj, undefined)
  assert.deepEqual(r.gm.objects[r.gm.obj], { ref: { class: 'lua:Game.Shop' } })
  const s = adhocDef({ obj: '@sub.UQuestSubsystem', function: 'Reset' }, lib)
  assert.deepEqual(s.gm.objects['@sub.UQuestSubsystem'], { src: '@sub.UQuestSubsystem' })
})

test('出错写清楚怎么办：对象不在列表、调函数没写 function、改值没写 value', () => {
  assert.throws(() => adhocDef({ obj: '商店', function: 'Open' }, lib), /对象列表里没有「商店」/)
  assert.throws(() => adhocDef({ obj: '背包', function: 'X', args: { a: { $obj: '没有' } } }, lib), /没有「没有」/)
  assert.throws(() => adhocDef({ obj: '背包' }, lib), /function/)
  assert.throws(() => adhocDef({ obj: '背包', kind: 'set', prop: '@#gold' }, lib), /value/)
})
