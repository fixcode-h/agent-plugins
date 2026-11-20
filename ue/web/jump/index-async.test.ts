// 本地索引的异步搜索：分片、增量、只排前几个。用法：node --test ue/web/jump/index-async.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { refines, searchIndex, topK } from './index-async.ts'
import { matchAssets, queryTerms, toAsset, type LoadedIndex } from './index-match.ts'

const big: LoadedIndex = {
  version: '1',
  assets: Array.from({ length: 20000 }, (_, i) =>
    toAsset([`/Game/PVS/Area${i % 50}/SM_Rock_${i}.SM_Rock_${i}`, i % 7 ? 'StaticMesh' : 'Blueprint']),
  ),
  lua: [],
  source: { assets: 'disk' } as LoadedIndex['source'],
}
const opt = { limit: 30, folderLimit: 10, budgetMs: 2 }

test('和同步排序的结果一样（档位、名字长度、名字）', async () => {
  for (const q of ['rock_1', 'sm_rock_4999', 'area3 rock', 'pvs/area1']) {
    const a = await searchIndex(big, q, '', opt)
    const b = matchAssets(big, queryTerms(q), 30)
    assert.equal(a!.total, b.total, q)
    assert.deepEqual(
      a!.rows.map((r) => r.name),
      b.rows.map((r) => r.name),
      q,
    )
  }
})

test('文件夹命中、按类型筛时不列文件夹', async () => {
  const r = await searchIndex(big, 'area4', '', opt)
  assert.ok(r!.folders.includes('/Game/PVS/Area4'))
  const c = await searchIndex(big, 'rock_7', 'blueprint', opt)
  assert.equal(c!.folders.length, 0)
  assert.ok(c!.rows.every((x) => x.cls === 'Blueprint'))
})

test('增量：接着打字的结果和从头搜一样', async () => {
  await searchIndex(big, 'rock', '', opt)
  const inc = await searchIndex(big, 'rock_12', '', opt)
  const full = matchAssets(big, queryTerms('rock_12'), 30)
  assert.equal(inc!.total, full.total)
  assert.ok(refines(['rock'], ['rock_12']))
  assert.ok(!refines(['rock_12'], ['rock']))
})

test('作废了返回 undefined', async () => {
  const cancel = { aborted: false }
  const p = searchIndex(big, 'e', '', { ...opt, budgetMs: 0, cancel })
  cancel.aborted = true
  assert.equal(await p, undefined)
})

test('topK 只取前几个', () => {
  const rows = big.assets.slice(0, 100).map((r, i) => ({ r, s: i % 4 }))
  assert.equal(topK(rows, 5).length, 5)
})
