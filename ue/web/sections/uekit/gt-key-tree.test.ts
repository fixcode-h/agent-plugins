import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRows } from './gt-key-tree.ts'

/** 只核对给出的几个字段 */
const has = (o: unknown, p: Record<string, unknown>) =>
  !!o && Object.entries(p).every(([k, v]) => (o as Record<string, unknown>)[k] === v)

const labels = { any: '任何容器', noScreen: '没写屏' }
const rules = [
  { entry: 'WBP_BagSlot', container: 'WBP_Bag:Root/ItemList', by: ['Data.ItemId'] },
  { entry: 'WBP_MailRow', container: 'WBP_Mail:Root/List', by: ['SentAt'] },
  { entry: 'WBP_Cell', by: ['@self.SkillType', '@self.Level'] },
  { entry: 'WBP_ShopGoods', container: 'WBP_Bag:Root/ItemList', by: ['@lua.cfgId'] },
  { entry: 'WBP_Row', container: 'Root/Rows', by: ['Id'] },
]

test('按屏、容器分组，任何容器排最前', () => {
  const { rows, total } = buildRows(rules, '', new Set(), labels)
  assert.equal(total, 5)
  assert.ok(has(rows[0], { kind: 'group', label: '任何容器', count: 1 }))
  assert.ok(has(rows[1], { kind: 'rule', index: 2, depth: 1 }))
  const bag = rows.findIndex((r) => r.kind === 'group' && r.label === 'WBP_Bag')
  assert.ok(has(rows[bag], { count: 2 }))
  assert.ok(has(rows[bag + 1], { kind: 'group', depth: 1, label: 'Root/ItemList', count: 2 }))
  assert.ok(rows.some((r) => r.kind === 'group' && r.label === '没写屏'))
})

test('收起的分组不出子行，搜索时全部展开', () => {
  const closed = new Set(['s:WBP_Bag'])
  const { rows } = buildRows(rules, '', closed, labels)
  assert.ok(!rows.some((r) => r.kind === 'rule' && r.index === 0))
  const found = buildRows(rules, 'itemid', closed, labels)
  assert.equal(found.total, 1)
  assert.deepEqual(
    found.rows.map((r) => r.kind),
    ['group', 'group', 'rule'],
  )
})

test('三千条也只是一次遍历', () => {
  const many = Array.from({ length: 3000 }, (_, i) => ({
    entry: `WBP_E${i}`,
    container: `WBP_S${i % 30}:Root/L${i % 7}`,
    by: ['Id'],
  }))
  const t0 = performance.now()
  const { rows, total } = buildRows(many, '', new Set(), labels)
  assert.equal(total, 3000)
  assert.equal(rows.length, 3000 + 30 + 30 * 7)
  assert.ok(performance.now() - t0 < 200)
})
