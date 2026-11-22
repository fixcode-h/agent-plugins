// GM 页右键菜单里对自定义 GM 和宏的改动（重命名、复制一份、删除）。
// 用法：node --test ue/shared/gm/item-ops.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copyCustom, copyMacro, copyName, deleteCustom, deleteMacro, macrosUsing, renameCustom } from './item-ops.ts'
import { GmStore } from './schema.ts'

const g = GmStore.parse({
  version: 2,
  modules: [{ id: 'shop', name: '商店' }],
  custom: [
    {
      id: 'c1',
      name: '买商品',
      module: 'shop',
      by: 'agent',
      obj: '商店界面',
      objects: { 商店界面: { src: '@pawn' } },
      function: 'BuyItem',
      args: { Id: 1 },
    },
    { id: 'c2', name: '卖商品', module: 'shop', obj: '商店界面', objects: { 商店界面: { src: '@pawn' } } },
  ],
  moduleOf: { 'custom:c1': 'shop', 'lua:X': 'shop' },
  common: [{ key: 'custom:c1' }, { key: 'lua:X' }, { key: 'macro:m1' }],
  macros: [
    { id: 'm1', name: '开店', steps: [{ custom: 'c1' }, { console: 'stat fps' }] },
    { id: 'm2', name: '别的', steps: [{ lua: 'X' }] },
  ],
})

test('副本名字不和已有的重', () => {
  assert.equal(copyName('A', []), 'A 副本')
  assert.equal(copyName('A', ['A 副本']), 'A 副本 2')
  assert.equal(copyName('A', ['A 副本', 'A 副本 2']), 'A 副本 3')
})

test('自定义 GM 改名：和别的重名抛错', () => {
  assert.equal(renameCustom(g, 'c1', '买东西').custom[0].name, '买东西')
  assert.throws(() => renameCustom(g, 'c1', '卖商品'), /已经有/)
  assert.equal(renameCustom(g, 'c1', '买商品').custom[0].name, '买商品')
})

test('自定义 GM 复制一份：新 id、放在原来后面、不带 Agent 标记、参数是深拷贝', () => {
  const r = copyCustom(g, 'c1')!
  assert.notEqual(r.id, 'c1')
  assert.deepEqual(
    r.g.custom.map((c) => c.name),
    ['买商品', '买商品 副本', '卖商品'],
  )
  const c = r.g.custom[1]
  assert.equal(c.by, undefined)
  assert.equal(c.module, 'shop')
  assert.notEqual(c.args, g.custom[0].args)
  assert.equal(copyCustom(g, 'nope'), undefined)
})

test('删自定义 GM：收藏、moduleOf、宏里调它的步骤一起去掉', () => {
  assert.deepEqual(
    macrosUsing(g, 'c1').map((m) => m.name),
    ['开店'],
  )
  const n = deleteCustom(g, 'c1')
  assert.deepEqual(
    n.custom.map((c) => c.id),
    ['c2'],
  )
  assert.deepEqual(n.common, [{ key: 'lua:X' }, { key: 'macro:m1' }])
  assert.deepEqual(n.moduleOf, { 'lua:X': 'shop' })
  assert.deepEqual(n.macros[0].steps, [{ console: 'stat fps' }])
  assert.equal(n.macros[1], g.macros[1])
})

test('宏复制一份、删除', () => {
  const r = copyMacro(g, 'm1')!
  assert.deepEqual(
    r.g.macros.map((m) => m.name),
    ['开店', '开店 副本', '别的'],
  )
  assert.notEqual(r.g.macros[1].steps, g.macros[0].steps)
  const n = deleteMacro(g, 'm1')
  assert.deepEqual(
    n.macros.map((m) => m.id),
    ['m2'],
  )
  assert.equal(
    n.common.some((f) => f.key === 'macro:m1'),
    false,
  )
})
