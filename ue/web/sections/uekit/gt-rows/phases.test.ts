import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { callTree, groupPhases, outcomeOf, pendingRows, recordKey } from './phases.ts'

const r = (o: Record<string, unknown>) => ({ index: 0, status: 'succeeded', ...o }) as never

test('子脚本的步骤挂在调用那一步下面，调用行排在前面', () => {
  const rows = callTree([
    r({ path: 'steps.0' }),
    r({ path: 'steps.0', calls: ['c1'], title: '子1' }),
    r({ path: 'steps.1', calls: ['c1'], title: '子2' }),
    r({ path: 'steps.1', id: 'c1', action: 'call', block: true }),
    r({ path: 'steps.2' }),
  ])
  assert.deepEqual(
    rows.map((x) => [x.key, x.depth]),
    [
      ['steps.0', 0],
      ['c1', 0],
      ['steps.0', 1],
      ['steps.1', 1],
      ['steps.2', 0],
    ],
  )
  assert.equal(rows[1].step && (rows[1].step as { action: string }).action, 'call')
})

test('调用还没跑完：先给一个占位行，子步骤挂在下面；两层调用缩两级', () => {
  const rows = callTree([r({ path: 'steps.0', calls: ['c1'] }), r({ path: 'steps.0', calls: ['c1', 'c2'] })])
  assert.deepEqual(
    rows.map((x) => [x.key, x.depth, !!x.step]),
    [
      ['c1', 0, false],
      ['steps.0', 1, true],
      ['c2', 1, false],
      ['steps.0', 2, true],
    ],
  )
})

test('循环里调两次同一个脚本：各自一组', () => {
  const rows = callTree([
    r({ path: 'steps.0', calls: ['c1'] }),
    r({ path: 'steps.0.do.0', id: 'c1', action: 'call', block: true }),
    r({ path: 'steps.0', calls: ['c1'] }),
    r({ path: 'steps.0.do.0', id: 'c1', action: 'call', block: true }),
  ])
  assert.deepEqual(
    rows.map((x) => x.depth),
    [0, 1, 0, 1],
  )
})

test('执行前失败算前置不满足，执行段没跑', () => {
  const recs = [
    r({ setup: true, index: 0 }),
    r({ setup: true, index: 1, status: 'failed' }),
    r({ path: 'steps.0', status: 'skipped' }),
    r({ teardown: true, path: 'teardown.0' }),
  ]
  assert.equal(outcomeOf(recs), 'blocked')
  const g = groupPhases(recs, { live: false })
  assert.deepEqual(
    g.map((x) => x.state),
    ['blocked', 'skipped', 'passed'],
  )
})

test('执行段失败是失败；执行后的警告不改结论', () => {
  const recs = [r({ path: 'steps.0', status: 'failed' }), r({ teardown: true, status: 'failed', warn: true })]
  assert.equal(outcomeOf(recs), 'failed')
  assert.equal(groupPhases(recs, { live: false })[2].state, 'warned')
})

test('跑着时按 job 的 phase / phases 定当前段和进度；空段标 empty', () => {
  const g = groupPhases([r({ path: 'steps.0' })], {
    live: true,
    phase: 'steps',
    phases: { setup: { done: 0, total: 0 }, steps: { done: 1, total: 5 }, teardown: { done: 0, total: 2 } },
  })
  assert.deepEqual(
    g.map((x) => [x.state, x.done, x.total]),
    [
      ['empty', 0, 0],
      ['running', 1, 5],
      ['pending', 0, 2],
    ],
  )
})

test('不同段、不同子脚本的同号记录键不撞', () => {
  const a = recordKey(r({ index: 0, setup: true }))
  const b = recordKey(r({ index: 0, path: 'steps.0' }))
  const c = recordKey(r({ index: 0, path: 'steps.0', calls: ['c1'] }))
  assert.equal(new Set([a, b, c]).size, 3)
})

test('跑着时补上还没跑到的顶层步骤：已跑的不重复，正在跑的调用 / 块里时下一步不转圈', () => {
  const outline = [
    { id: 'c1', action: 'call' },
    { id: 's1', action: 'click' },
    { id: 's2', action: 'check' },
  ]
  // 第一步跑完：后两步没跑到，s1 是下一步
  const done = [{ index: 0, action: 'call', status: 'succeeded', path: 'steps.0', id: 'c1', block: true }]
  const p1 = pendingRows('steps', done, callTree(done), outline, true)
  assert.deepEqual(
    p1.map((r) => [r.key, !!r.next]),
    [
      ['s1', true],
      ['s2', false],
    ],
  )
  // 调用还在跑（只有子脚本的记录）：c1 是占位行不再补，s1 不转圈
  const inCall = [{ index: 0, action: 'key', status: 'succeeded', path: 'steps.0', calls: ['c1'] }]
  const p2 = pendingRows('steps', inCall, callTree(inCall), outline, true)
  assert.deepEqual(
    p2.map((r) => [r.key, !!r.next]),
    [
      ['s1', false],
      ['s2', false],
    ],
  )
  // 还没开始的段：全列出来、都不转圈
  assert.equal(pendingRows('teardown', [], [], [{ action: 'api' }], false)[0].key, 'teardown.0')
})
