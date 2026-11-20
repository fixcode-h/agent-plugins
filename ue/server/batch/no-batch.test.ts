// 批量不了时的报错和 ue_find kind=asset select 的分页：纯函数，单测直接跑。
// 用法（在仓库根）：node --test ue/server/batch/no-batch.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pageOf } from './select-filter.ts'
import { noBatchMessage } from './no-batch.ts'

const ASSET = ['describe', 'export', 'refs', 'set', 'help']

test('把 select 当成动作（ue_asset action=select）：说清 select 是参数，指到 ue_find kind=asset select，不再说「不支持批量」', () => {
  const m = noBatchMessage('ue_asset', 'select', ['describe', 'refs'], ASSET)
  assert.match(m, /没有 action=select/)
  assert.match(m, /select 不是动作/)
  assert.match(m, /能批量的 action：describe \/ refs/)
  assert.match(m, /ue_find kind=asset select=/)
  assert.doesNotMatch(m, /不支持批量/)
})

test('不认识的 action、没给 action 也走「没有这个 action」', () => {
  assert.match(noBatchMessage('ue_asset', 'find', ['describe'], ASSET), /没有 action=find/)
  assert.match(noBatchMessage('ue_blueprint', undefined, ['outline'], ['outline', 'graph']), /要给 action/)
})

test('有这个 action 但批量不了：让逐个调，并列出能批量的', () => {
  const m = noBatchMessage('ue_blueprint', 'node_search', ['outline', 'graph', 'edit'], ['outline', 'node_search'])
  assert.match(m, /action=node_search 批量不了.*逐个调/)
  assert.match(m, /能批量的 action：outline \/ graph \/ edit/)
  // 不给 actions 时不判断有没有这个动作
  assert.match(noBatchMessage('ue_asset', 'select', [], undefined), /action=select 批量不了/)
})

test('ue_find select 的结果分页：默认 50 条，带 nextOffset，limit 有上限', () => {
  const paths = Array.from({ length: 120 }, (_, i) => `/Game/A/BP_${i}.BP_${i}`)
  const p1 = pageOf(paths, undefined, undefined)
  assert.equal(p1.total, 120)
  assert.equal(p1.count, 50)
  assert.equal(p1.nextOffset, 50)
  const last = pageOf(paths, 100, 50)
  assert.equal(last.count, 20)
  assert.equal(last.hasMore, undefined)
  assert.equal(pageOf(paths, 0, 9999).count, 120)
  assert.equal(pageOf([...paths, ...paths], 0, 9999).count, 150)
  assert.equal(pageOf([], 0, 0).total, 0)
})
