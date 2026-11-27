import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GtScript } from '../../../../../shared/gt-script/index.ts'
import {
  addLoose,
  clearPositions,
  connect,
  disconnect,
  insertAtPin,
  moveNodes,
  setPositions,
  tidyLoose,
} from './edit.ts'
import { bpGraph, findScope, layoutOf, looseSlot, pinOf, SETUP_KEY, START_KEY, TEARDOWN_KEY } from './graph.ts'

const doc = (): GtScript => ({
  schemaVersion: 3,
  guards: [{ id: 'g1', name: '断线', when: {}, do: [{ id: 's9', action: 'click', target: 'A:B' }] }],
  steps: [
    { id: 's1', action: 'click', target: 'X:Y' },
    {
      id: 'if1',
      action: 'if',
      cond: { all: [] },
      then: [{ id: 's2', action: 'wait', seconds: 1 }],
      else: [],
    },
    { id: 's3', action: 'assert', target: 'X:Z' },
  ],
})

const edge = (g: ReturnType<typeof bpGraph>, from: string, pin: string) =>
  g.edges.find((e) => e.from === from && e.pin === pin)?.to

test('图：开始 → 一步一步接下去，「如果」在画布上摊开：是 / 否出口直接连，「之后」接块后面那步', () => {
  const g = bpGraph(doc())
  assert.equal(edge(g, START_KEY, 'next'), 's1')
  assert.equal(edge(g, 's1', 'next'), 'if1')
  assert.equal(edge(g, 'if1', 'next'), 's3')
  assert.deepEqual(
    g.nodes.find((n) => n.id === 'if1')!.outs.map((p) => p.id),
    ['s:then', 's:else', 'next'],
  )
  assert.equal(edge(g, 'if1', 's:then'), 's2')
  assert.equal(g.nodes.find((n) => n.id === 'if1')!.folded, undefined)
  // 「如果」不是子图，进不去
  assert.equal(findScope(doc(), 'if1'), undefined)
  // 守护是事件节点，后面接处理步骤
  assert.equal(edge(g, 'g:g1', 'next'), 's9')
})

test('图：记过的位置照记的，没记的跟着前一个节点挪', () => {
  const d = setPositions(doc(), [{ key: 's1', x: 1000, y: 500 }])!
  const g = bpGraph(d)
  const s1 = g.nodes.find((n) => n.id === 's1')!
  const if1 = g.nodes.find((n) => n.id === 'if1')!
  assert.deepEqual([s1.x, s1.y], [1000, 500])
  const auto = bpGraph(doc())
  const a1 = auto.nodes.find((n) => n.id === 's1')!
  const ai = auto.nodes.find((n) => n.id === 'if1')!
  assert.deepEqual([if1.x - s1.x, if1.y - s1.y], [ai.x - a1.x, ai.y - a1.y])
  assert.deepEqual(layoutOf(clearPositions(d)).pos, undefined)
})

test('拖节点：后面连着的不跟着动，钉在原来的位置', () => {
  const g0 = bpGraph(doc())
  const if0 = g0.nodes.find((n) => n.id === 'if1')!
  const d = moveNodes(doc(), g0, [{ key: 's1', x: 1000, y: 500 }])!
  const g = bpGraph(d)
  const if1 = g.nodes.find((n) => n.id === 'if1')!
  assert.deepEqual([if1.x, if1.y], [if0.x, if0.y])
  assert.deepEqual(g.nodes.find((n) => n.id === 's1')!.x, 1000)
  // 拖第二个节点也只动它自己，记过的不被覆盖
  const d2 = moveNodes(d, g, [{ key: 'if1', x: 7, y: 7 }])!
  assert.deepEqual(layoutOf(d2).pos!.s1, [1000, 500])
  assert.deepEqual(layoutOf(d2).pos!.if1, [7, 7])
})

test('断开：后面那串变成没连上的，位置跟着换成 ~id', () => {
  const d0 = setPositions(doc(), [{ key: 's3', x: 9, y: 9 }])!
  const d = disconnect(d0, { slot: ['steps'], index: 2 })!
  assert.equal((d.steps ?? []).length, 2)
  const loose = layoutOf(d).loose!
  assert.equal(loose[0].steps[0].id, 's3')
  assert.deepEqual(layoutOf(d).pos!['~s3'], [9, 9])
  const g = bpGraph(d)
  const n = g.nodes.find((x) => x.id === '~s3')!
  assert.equal(n.loose, true)
  assert.deepEqual([n.x, n.y], [9, 9])
})

test('连线：把没连上的接回去，原来接着的那串断开', () => {
  const d1 = disconnect(doc(), { slot: ['steps'], index: 2 })!
  // 「是」里原来是 s2：接上 s3 后 s2 变成没连上的
  const r = connect(d1, { slot: ['steps', 1, 'then'], index: 0 }, [...looseSlot(0), 0])!
  const then = (r.doc.steps![1] as unknown as { then: { id: string }[] }).then
  assert.deepEqual(
    then.map((s) => s.id),
    ['s3'],
  )
  assert.deepEqual(r.path, ['steps', 1, 'then', 0])
  const loose = layoutOf(r.doc).loose!
  assert.equal(loose.length, 1)
  assert.equal(loose[0].steps[0].id, 's2')
})

test('连线：不能接成环', () => {
  // if1 的「是」接回 s1（s1 后面那串含 if1 自己）
  assert.equal(connect(doc(), { slot: ['steps', 1, 'then'], index: 0 }, ['steps', 0]), undefined)
  // s3 的下一步接回 s1
  assert.equal(connect(doc(), { slot: ['steps'], index: 3 }, ['steps', 0]), undefined)
  // 已经接着
  assert.equal(connect(doc(), { slot: ['steps'], index: 1 }, ['steps', 1]), undefined)
})

test('连线：流程里往前挪（开始直接接 if1，s1 断开）', () => {
  const r = connect(doc(), { slot: ['steps'], index: 0 }, ['steps', 1])!
  assert.deepEqual(
    r.doc.steps!.map((s) => s.id),
    ['if1', 's3'],
  )
  assert.equal(layoutOf(r.doc).loose![0].steps[0].id, 's1')
})

test('空白处加节点、在引脚处插入', () => {
  const r = addLoose(doc(), [{ action: 'click', target: 'Q:W' }], 100, 200)
  const loose = layoutOf(r.doc).loose!
  const id = loose[0].steps[0].id!
  assert.ok(!['s1', 's2', 's3', 's9'].includes(id))
  assert.deepEqual(layoutOf(r.doc).pos![`~${id}`], [100, 200])
  const g = bpGraph(r.doc)
  assert.ok(pinOf(g, `~${id}`, 'next'))

  const ins = insertAtPin(doc(), { slot: ['steps'], index: 1 }, [{ action: 'wait', seconds: 2 }], 5, 6)!
  const ids = ins.doc.steps!.map((s) => s.id)
  assert.equal(ids.length, 4)
  assert.equal(ids[0], 's1')
  assert.equal(ids[2], 'if1')
  assert.deepEqual(layoutOf(ins.doc).pos![ids[1]!], [5, 6])
})

test('没连上的 id 和流程里新插的撞了：没连上的换一个，接回去不重复', () => {
  const d1 = disconnect(doc(), { slot: ['steps'], index: 2 })!
  // 模拟别的视图在流程里插了一个同 id 的步骤
  d1.steps!.push({ id: 's3', action: 'wait', seconds: 1 })
  const r = connect(d1, { slot: ['steps', 1, 'else'], index: 0 }, [...looseSlot(0), 0])!
  const ids = new Set<string>()
  const all = JSON.stringify(r.doc)
  for (const m of all.matchAll(/"id":"([^"]+)"/g)) {
    assert.ok(!ids.has(m[1]), `重复 id ${m[1]}`)
    ids.add(m[1])
  }
})

const nested = (): GtScript =>
  ({
    schemaVersion: 3,
    steps: [
      {
        id: 'g1',
        action: 'group',
        do: [
          { id: 'a1', action: 'wait', seconds: 1 },
          { id: 'r1', action: 'loop', until: { all: [] }, max: 2, do: [{ id: 'b1', action: 'wait', seconds: 1 }] },
        ],
      },
      { id: 'g2', action: 'group', do: [{ id: 'c1', action: 'wait', seconds: 1 }] },
    ],
  }) as unknown as GtScript

test('子图：段在外层只画一个节点，进到里面只画它里面的，循环在里面摊开画', () => {
  const ids = (g: ReturnType<typeof bpGraph>) => g.nodes.map((n) => n.id).sort()
  const top = bpGraph(nested())
  assert.deepEqual(ids(top), [SETUP_KEY, START_KEY, TEARDOWN_KEY, 'g1', 'g2'].sort())
  assert.equal(top.nodes.find((n) => n.id === 'g1')!.folded, 3)
  assert.deepEqual(
    top.nodes.find((n) => n.id === 'g1')!.outs.map((p) => p.id),
    ['next'],
  )

  const inG1 = bpGraph(nested(), { scope: ['steps', 0] })
  assert.deepEqual(ids(inG1), ['#in:do', 'a1', 'b1', 'r1'].sort())
  assert.equal(edge(inG1, '#in:do', 'next'), 'a1')
  assert.equal(edge(inG1, 'a1', 'next'), 'r1')
  assert.equal(edge(inG1, 'r1', 's:do'), 'b1')
  assert.equal(findScope(nested(), 'r1'), undefined)
})

test('子图：段里还能再放段，一层一层进', () => {
  const d = nested()
  ;(d.steps![0] as unknown as { do: unknown[] }).do.push({
    id: 'g3',
    action: 'group',
    do: [{ id: 'd1', action: 'wait', seconds: 1 }],
  })
  const g3 = findScope(d, 'g3')!
  assert.deepEqual(g3, ['steps', 0, 'do', 2])
  assert.deepEqual(
    bpGraph(d, { scope: g3 })
      .nodes.map((n) => n.id)
      .sort(),
    ['#in:do', 'd1'],
  )
  // 循环里断开的那串记在外面那个段（循环不算一层）
  const cut = disconnect(nested(), { slot: ['steps', 0, 'do', 1, 'do'], index: 0 })!
  assert.equal(layoutOf(cut).loose![0].scope, 'g1')
})

test('子图：里面加的、断开的节点记在这一层，块删了跟着没', () => {
  const r = addLoose(nested(), [{ action: 'click', target: 'Q:W' }], 0, 0, 'g1')
  const id = layoutOf(r.doc).loose![0].steps[0].id!
  assert.ok(!bpGraph(r.doc).nodes.some((n) => n.id === `~${id}`))
  assert.ok(bpGraph(r.doc, { scope: ['steps', 0] }).nodes.some((n) => n.id === `~${id}`))
  // 在 g1 里面断开 r1：断下来的那串还在 g1 这一层
  const d = disconnect(nested(), { slot: ['steps', 0, 'do'], index: 1 })!
  assert.equal(layoutOf(d).loose![0].scope, 'g1')
  assert.ok(bpGraph(d, { scope: ['steps', 0] }).nodes.some((n) => n.id === '~r1'))
  // 删掉 g1：它那层的没连上的也清掉
  const gone = tidyLoose({ ...r.doc, steps: r.doc.steps!.slice(1) })
  assert.equal(layoutOf(gone).loose, undefined)
})

test('三段事件（执行前 / 执行 / 执行后）每个脚本都有，从上到下排；后面接各自的步骤', () => {
  const d: GtScript = {
    schemaVersion: 5,
    steps: [{ id: 's1', action: 'key', key: 'E' }],
    teardown: [
      { id: 't1', action: 'key', key: 'Escape' },
      { id: 't2', action: 'key', key: 'Q' },
    ],
  }
  const g = bpGraph(d)
  const ev = g.nodes.find((n) => n.id === TEARDOWN_KEY)
  assert.equal(ev?.kind, 'teardown')
  assert.ok(g.nodes.some((n) => n.kind === 'step' && n.path?.join('.') === 'teardown.1'))
  // 空的段也画事件节点（用户 2026-11-27：三个节点默认在、不能删），后面没接东西运行时跳过
  const empty = bpGraph({ ...d, teardown: [] })
  const ev3 = [SETUP_KEY, START_KEY, TEARDOWN_KEY].map((k) => empty.nodes.find((n) => n.id === k)!)
  assert.ok(ev3.every(Boolean))
  assert.ok(ev3[0].y < ev3[1].y && ev3[1].y < ev3[2].y)
})
