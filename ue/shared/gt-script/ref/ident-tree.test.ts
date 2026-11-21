// 唯一标识的条件组（协议 3.5，GameTest 2.1.6）和带参数的取值函数路径（3.1）。
// 用法：node --test ue/shared/gt-script/ref/ident-tree.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GtScript } from '../types.ts'
import { describeIdent } from './describe.ts'
import { groupAt, identLeaves, makeGroup, normalizeIdent, toGroups, updateGroupAt } from './ident-tree.ts'
import { formatPropPath, parseFnArgs, parsePropPath } from './path.ts'
import type { GtIdentNode } from './types.ts'
import { validateRefs } from './validate.ts'

const A = { prop: '@.ItemId', op: 'eq', value: 1001 }
const B = { prop: '@.GetStock(1)', op: 'gt', value: 3 }
const C = { prop: '@.IsSoldOut()', not: true }

test('平铺写法看成每项一组，收拾时拆回平铺', () => {
  const groups = toGroups([A, C])
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0], { all: [A] })
  assert.deepEqual(normalizeIdent(groups), [A, C])
})

test('收拾：空组去掉，单项子组拆开，取反的单项子组变成取反的那一项', () => {
  const tree: GtIdentNode[] = [
    makeGroup('all', [A, makeGroup('any', [B, C]), makeGroup('any', [])]),
    makeGroup('all', []),
    makeGroup('any', [makeGroup('all', [B])], true),
  ]
  assert.deepEqual(normalizeIdent(tree), [{ all: [A, { any: [B, C] }] }, { ...B, not: true }])
})

test('按位置改组，叶子去重', () => {
  const groups = toGroups([makeGroup('all', [A, makeGroup('any', [B])])])
  assert.deepEqual(groupAt(groups, [0, 1]), { any: [B] })
  assert.equal(groupAt(groups, [0, 0]), undefined)
  const next = updateGroupAt(groups, [0, 1], (g) => makeGroup('any', [...(g.any ?? []), C]))
  assert.deepEqual(next[0], { all: [A, { any: [B, C] }] })
  assert.deepEqual(groups[0], { all: [A, { any: [B] }] }, '不改原来的')
  assert.deepEqual(
    identLeaves([A, makeGroup('any', [A, B])]).map((x) => x.prop),
    ['@.ItemId', '@.GetStock(1)'],
  )
})

test('读起来的一句话', () => {
  assert.equal(describeIdent([A, makeGroup('any', [B, C])]), 'ItemId = 1001，（GetStock(1) > 3 或 非 IsSoldOut()）')
  assert.equal(describeIdent([makeGroup('all', [A, B], true)]), '非（ItemId = 1001 且 GetStock(1) > 3）')
})

test('函数参数：只认常量，括号里的 . : , 不拆段', () => {
  const p = parsePropPath('@/Slot.Find(1001, "a.b:c, d", true).Id:exists')
  assert.ok(!('error' in p))
  assert.equal(p.segs[1].kind, 'fn')
  assert.equal(p.segs[1].args, '1001, "a.b:c, d", true')
  assert.equal(formatPropPath(p), '@/Slot.Find(1001, "a.b:c, d", true).Id:exists')
  assert.deepEqual(parseFnArgs('1, -2.5, "x\\"y", \'z\', false, null'), [1, -2.5, 'x"y', 'z', false, null])
  assert.deepEqual(parseFnArgs(''), [])
  for (const bad of ['@.Get(1', '@.Get(abc)', '@.Get(1,,2)', '@#tbl(1)', '@.Get("x)'])
    assert.ok('error' in parsePropPath(bad), bad)
})

const doc = (ident: unknown): GtScript =>
  ({ schemaVersion: 5, objects: { item: { class: 'WBP_Item', ident } }, steps: [] }) as unknown as GtScript

test('校验：条件组的写法', () => {
  assert.deepEqual(validateRefs(doc([A, makeGroup('any', [B, C])])), [])
  const codes = (ident: unknown) => validateRefs(doc(ident)).map((x) => x.code)
  assert.deepEqual(codes([{ all: [A], any: [B] }]), ['bad_type'])
  assert.deepEqual(codes([{ any: [] }]), ['bad_type'])
  assert.deepEqual(codes([{ all: [A], mode: 'or' }]), ['unknown_field'])
  assert.deepEqual(codes([{ all: [{ all: [{ all: [{ all: [{ all: [A] }] }] }] }] }]), ['bad_type'])
  assert.deepEqual(codes([{ all: [{ prop: '@.Get(abc)' }] }]), ['path_syntax'])
})
