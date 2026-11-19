import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asSubgraph } from './subgraph-swap.ts'

test('子图：选了脚本换成调用，id、名字、说明留着，里面的步骤换掉', () => {
  const g = { id: 'grp1', action: 'group', name: '打开福利', note: '说明', do: [{ action: 'wait', seconds: 1 }] }
  assert.deepEqual(asSubgraph(g, 'common/登录'), {
    id: 'grp1',
    action: 'call',
    name: '打开福利',
    note: '说明',
    script: 'common/登录',
    with: {},
  })
})

test('子图：清掉脚本换回空的段；换另一个脚本参数清空，同一个脚本参数留着', () => {
  const c = { id: 'call1', action: 'call', script: 'a/b.json', with: { n: 1 }, saveAs: 'r', onFail: 'continue' }
  assert.deepEqual(asSubgraph(c, ''), { id: 'call1', action: 'group', onFail: 'continue', do: [] })
  assert.deepEqual(asSubgraph(c, 'a/c').with, {})
  assert.equal(asSubgraph(c, 'a/c').saveAs, 'r')
  assert.deepEqual(asSubgraph(c, 'a/b').with, { n: 1 })
})
