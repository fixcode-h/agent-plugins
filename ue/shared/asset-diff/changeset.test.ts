/** 同一次提交里一起改的资源：分组、类型分布、整批搬运提交的识别 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bulkKind, folderOf, groupAssets, typeSpread } from './changeset.ts'

const a = (pkg: string, cls = '') => ({ pkg, cls })

test('按文件夹分组：按路径排，组里按名字排', () => {
  const g = groupAssets([a('/Game/B/X'), a('/Game/A/Z'), a('/Game/A/Y')], 'folder')
  assert.deepEqual(
    g.map((x) => [x.key, x.items.map((i) => i.pkg)]),
    [
      ['/Game/A', ['/Game/A/Y', '/Game/A/Z']],
      ['/Game/B', ['/Game/B/X']],
    ],
  )
  assert.equal(folderOf('/Game'), '/')
})

test('按类型分组：多的在前，keyOf 能把几类并成一组', () => {
  const items = [a('/G/1', 'AnimSequence'), a('/G/2', 'AnimMontage'), a('/G/3', 'Material'), a('/G/4', 'AnimSequence')]
  const g = groupAssets(items, 'type')
  assert.deepEqual(
    g.map((x) => [x.key, x.items.length]),
    [
      ['AnimSequence', 2],
      ['AnimMontage', 1],
      ['Material', 1],
    ],
  )
  const merged = groupAssets(items, 'type', (x) => (x.cls.startsWith('Anim') ? 'anim' : x.cls))
  assert.deepEqual(merged[0].items.length, 3)
})

test('类型分布：前几种 + 剩下的个数', () => {
  const items = ['A', 'A', 'A', 'B', 'B', 'C', 'D', 'E'].map((c, i) => a(`/G/${i}`, c))
  assert.deepEqual(
    typeSpread(items, (x) => x.cls, 2),
    {
      parts: [
        { key: 'A', n: 3 },
        { key: 'B', n: 2 },
      ],
      rest: 3,
    },
  )
})

test('认出整批搬运的提交', () => {
  assert.equal(bulkKind('[Auto-Merge] Copying //Silver/Dev/... to //Silver/Main/...'), 'copy')
  assert.equal(bulkKind('Merging //depot/Main to //depot/Release'), 'merge')
  assert.equal(bulkKind("Merge branch 'dev' into main"), 'merge')
  assert.equal(bulkKind('合并 dev 到 main'), 'merge')
  assert.equal(bulkKind('修复攻击动画的根运动'), undefined)
  assert.equal(bulkKind('Fix copy button'), undefined)
})
