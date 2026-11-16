/** 表格文件列表的增量：算增删改、合进页面手上的列表、同一份合两次不重复、太多时让页面整份重取 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TableFile, TablesIndex } from './tables.ts'
import { MAX_LIST_DELTA, applyTablesDelta, diffTablesIndex } from './table-list.ts'

const f = (path: string, kind: TableFile['kind'] = 'xlsx'): TableFile => ({ path, kind })
const idx = (files: TableFile[], extra: Partial<TablesIndex> = {}): TablesIndex => ({
  dirs: ['T'],
  missing: [],
  files,
  ...extra,
})

test('没变化返回 null；增删改都算出来，合进旧列表后和新列表一样（按路径排好）', () => {
  const old = idx([f('T/a.xlsx'), f('T/b.xlsx'), f('T/c.xlsx')])
  assert.equal(diffTablesIndex('k', old, idx([...old.files])), null)
  const next = idx([f('T/a.xlsx'), f('T/a2.xlsx'), f('T/c.xlsx', 'xls')])
  const d = diffTablesIndex('k', old, next)
  assert.ok(d && !('reload' in d))
  assert.deepEqual(
    d.add.map((x) => x.path),
    ['T/a2.xlsx'],
  )
  assert.deepEqual(d.remove, ['T/b.xlsx'])
  assert.deepEqual(
    d.change.map((x) => x.path),
    ['T/c.xlsx'],
  )
  const merged = applyTablesDelta({ ...old, key: 'k', scanning: true }, d)!
  assert.deepEqual(merged.files, next.files)
  assert.equal(merged.scanning, false)
  assert.equal(merged.key, 'k')
  // 页面已经拿到新列表（刷新按钮等到了）再收到同一份增量：不多出重复的
  assert.deepEqual(applyTablesDelta(merged, d)!.files, next.files)
})

test('只是目录情况变了（找不到的目录、截断）也算变化', () => {
  const old = idx([f('T/a.xlsx')])
  const d = diffTablesIndex('k', old, idx([f('T/a.xlsx')], { missing: ['X'] }))
  assert.ok(d && !('reload' in d))
  assert.deepEqual(applyTablesDelta(old, d)!.missing, ['X'])
})

test('变化太多：让页面整份重取', () => {
  const many = Array.from({ length: MAX_LIST_DELTA + 1 }, (_, i) => f(`T/${i}.xlsx`))
  const d = diffTablesIndex('k', idx([]), idx(many))
  assert.deepEqual(d, { key: 'k', reload: true })
  assert.equal(applyTablesDelta(idx([]), d!), null)
})
