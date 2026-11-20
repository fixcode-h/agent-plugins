// Actor 蓝图布局的纯函数单测：node --test ue/web/inspect/layouts/blueprint/blueprint.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphEdges, hasPositions, layoutGraph, nodeTone, pinRows, rankNodes, type GNode } from './graph.ts'
import {
  byCategory,
  closeTab,
  CONSTRUCTION,
  defaultGraph,
  myBlueprint,
  openTab,
  resolveView,
  signature,
  typeTone,
  type BpOutline,
} from './model.ts'

const OUTLINE: BpOutline = {
  path: '/Game/BP_Door.BP_Door',
  name: 'BP_Door',
  parent: '/Script/Engine.Actor',
  status: 'ok',
  dirty: false,
  interfaces: [],
  variables: [
    { name: 'bIsOpen', type: 'Boolean', instanceEditable: true },
    { name: 'OpenAngle', type: 'Float', instanceEditable: false, category: 'Door' },
  ],
  dispatchers: [{ name: 'OnOpened', type: 'Multicast Delegate' }],
  graphs: [
    { name: CONSTRUCTION, kind: 'function', nodes: 1 },
    { name: 'EventGraph', kind: 'event', nodes: 14 },
    { name: 'ToggleDoor', kind: 'function', nodes: 5, inputs: [{ name: 'Open', type: 'Boolean' }] },
    { name: 'CanOpen', kind: 'function', nodes: 3, pure: true, outputs: [{ name: 'Ok', type: 'Boolean' }] },
    { name: 'IsPlayerPawn', kind: 'macro', nodes: 4 },
    { name: 'OnOpened__DelegateSignature', kind: 'delegate', nodes: 1 },
  ],
  timelines: ['OpenDoor'],
}

test('我的蓝图：按 UE 分组，事件图在构造脚本前，分发器签名图不列', () => {
  const s = myBlueprint(OUTLINE)
  const names = Object.fromEntries(s.map((x) => [x.id, x.items.map((i) => i.name)]))
  assert.deepEqual(names.graphs, ['EventGraph', CONSTRUCTION])
  assert.deepEqual(names.functions, ['ToggleDoor', 'CanOpen'])
  assert.deepEqual(names.macros, ['IsPlayerPawn'])
  assert.deepEqual(names.variables, ['bIsOpen', 'OpenAngle'])
  assert.deepEqual(names.dispatchers, ['OnOpened'])
  assert.equal(s.find((x) => x.id === 'variables')!.items[0].editable, true)
})

test('我的蓝图：按名字和类型筛，空组还在', () => {
  const s = myBlueprint(OUTLINE, 'bool')
  assert.deepEqual(
    s.find((x) => x.id === 'variables')!.items.map((i) => i.name),
    ['bIsOpen'],
  )
  assert.equal(s.length, 5)
  assert.equal(s.find((x) => x.id === 'macros')!.items.length, 0)
})

test('类型配色', () => {
  assert.equal(typeTone('exec'), 'fg')
  assert.equal(typeTone('Boolean'), 'danger')
  assert.equal(typeTone('Array of Booleans'), 'danger')
  assert.equal(typeTone('Float'), 'success')
  assert.equal(typeTone('Integer'), 'run')
  assert.equal(typeTone('Text'), 'peer')
  assert.equal(typeTone('Vector'), 'warning')
  assert.equal(typeTone('Actor Object Reference'), 'accent')
  assert.equal(typeTone('Multicast Delegate'), 'ask')
})

test('视图：没有视口，记住的旧值 viewport 落到图表；非 Actor 蓝图没有类默认值', () => {
  assert.equal(resolveView('viewport', true), 'graph')
  assert.equal(resolveView('viewport', undefined), 'graph')
  assert.equal(resolveView('defaults', false), 'graph')
  assert.equal(resolveView('defaults', true), 'defaults')
  assert.equal(resolveView('info', false), 'info')
})

test('图表页签：开、关后落到旁边那个', () => {
  assert.deepEqual(openTab(['EventGraph'], 'ToggleDoor'), ['EventGraph', 'ToggleDoor'])
  assert.deepEqual(openTab(['EventGraph'], 'EventGraph'), ['EventGraph'])
  assert.deepEqual(closeTab(['A', 'B', 'C'], 'B', 'B'), { tabs: ['A', 'C'], active: 'C' })
  assert.deepEqual(closeTab(['A', 'B'], 'B', 'B'), { tabs: ['A'], active: 'A' })
  assert.deepEqual(closeTab(['A', 'B'], 'B', 'A'), { tabs: ['A'], active: 'A' })
  assert.deepEqual(closeTab(['A'], 'A', 'A'), { tabs: [], active: '' })
  assert.equal(defaultGraph(OUTLINE), 'EventGraph')
})

// 一张小事件图：BeginPlay → Branch(Get bIsOpen) → SetRelativeRotation；外加一个注释和一个孤立节点
const exec = (name: string, dir: string, to?: string[]) => ({ name, dir, type: 'exec', to })
const GRAPH: GNode[] = [
  { id: 'c0', kind: 'comment', title: '开局', pins: [] },
  { id: 'e1', kind: 'event', title: 'Event BeginPlay', pins: [exec('then', 'out', ['b1.execute'])] },
  {
    id: 'b1',
    kind: 'branch',
    title: 'Branch',
    pins: [
      exec('execute', 'in', ['e1.then']),
      { name: 'Condition', dir: 'in', type: 'Boolean', to: ['g1.bIsOpen'] },
      exec('then', 'out', ['s1.execute']),
      exec('else', 'out'),
    ],
  },
  {
    id: 'g1',
    kind: 'get',
    title: 'Get bIsOpen',
    pins: [{ name: 'bIsOpen', dir: 'out', type: 'Boolean', to: ['b1.Condition'] }],
  },
  {
    id: 's1',
    kind: 'call',
    title: 'SetRelativeRotation',
    pins: [exec('execute', 'in', ['b1.then']), exec('then', 'out', ['zz.execute'])],
  },
  { id: 'lone', kind: 'call', title: 'PrintString', pins: [exec('execute', 'in')] },
]

test('连线只从输出引脚取，指向列表外的丢掉', () => {
  const es = graphEdges(GRAPH)
  assert.deepEqual(
    es.map((e) => `${e.from}.${e.fromPin}>${e.to}.${e.toPin}`),
    ['e1.then>b1.execute', 'b1.then>s1.execute', 'g1.bIsOpen>b1.Condition'],
  )
  assert.equal(es[2].exec, false)
})

test('分层：沿连线往右，Get 节点挪到用它的节点左边一列', () => {
  const nodes = GRAPH.filter((n) => n.kind !== 'comment')
  const r = rankNodes(nodes, graphEdges(nodes))
  assert.equal(r.get('e1'), 0)
  assert.equal(r.get('b1'), 1)
  assert.equal(r.get('s1'), 2)
  assert.equal(r.get('g1'), 0)
})

test('分层：有环也会停', () => {
  const loop: GNode[] = [
    { id: 'a', kind: 'call', title: 'A', pins: [exec('then', 'out', ['b.execute']), exec('execute', 'in')] },
    { id: 'b', kind: 'call', title: 'B', pins: [exec('then', 'out', ['a.execute']), exec('execute', 'in')] },
  ]
  const r = rankNodes(loop, graphEdges(loop))
  assert.ok((r.get('a') ?? 0) <= 2 && (r.get('b') ?? 0) <= 2)
})

test('摆位置：注释单列，不重叠，孤立节点叠在下面', () => {
  const { nodes, comments } = layoutGraph(GRAPH)
  assert.deepEqual(
    comments.map((c) => c.id),
    ['c0'],
  )
  assert.equal(nodes.length, 5)
  for (const a of nodes)
    for (const b of nodes) {
      if (a === b) continue
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
      assert.ok(!overlap, `${a.node.id} 和 ${b.node.id} 重叠`)
    }
  const at = Object.fromEntries(nodes.map((n) => [n.node.id, n]))
  assert.ok(at.b1.x > at.e1.x && at.s1.x > at.b1.x)
  assert.ok(at.lone.y > Math.max(at.e1.y + at.e1.h, at.b1.y + at.b1.h, at.g1.y + at.g1.h))
})

test('节点行：执行引脚排第一行，节点配色', () => {
  const rows = pinRows(GRAPH[2])
  assert.equal(rows[0].in?.name, 'execute')
  assert.equal(rows[0].out?.name, 'then')
  assert.equal(rows[1].in?.name, 'Condition')
  assert.equal(rows[1].out?.name, 'else')
  assert.equal(nodeTone(GRAPH[1]), 'danger')
  assert.equal(nodeTone(GRAPH[3]), 'danger')
  assert.equal(nodeTone(GRAPH[4]), 'accent')
})

test('有 UE 坐标（bp.layout）：照原位置画，注释有框的画成框', () => {
  const placed: GNode[] = GRAPH.map((n, i) =>
    n.kind === 'comment' ? { ...n, x: -40, y: -60, w: 600, h: 300, color: '#3366aa' } : { ...n, x: i * 300, y: i * 10 },
  )
  assert.equal(hasPositions(placed), true)
  assert.equal(hasPositions(GRAPH), false)
  const r = layoutGraph(placed)
  assert.equal(r.positioned, true)
  assert.deepEqual(
    r.nodes.map((n) => [n.node.id, n.x, n.y]),
    placed.filter((n) => n.kind !== 'comment').map((n) => [n.id, n.x, n.y]),
  )
  assert.equal(r.comments.length, 0)
  assert.deepEqual(
    r.boxes.map((b) => [b.node.id, b.w, b.h, b.color]),
    [['c0', 600, 300, '#3366aa']],
  )
  // 注释没给框：不画框，照旧列在上面
  const noBox = placed.map((n) => (n.kind === 'comment' ? { ...n, w: undefined, h: undefined } : n))
  assert.deepEqual(
    layoutGraph(noBox).comments.map((c) => c.id),
    ['c0'],
  )
  // 缺一个节点的坐标：整张自动排，不混着来
  const partial = placed.map((n, i) => (i === 1 ? { ...n, x: undefined } : n))
  assert.equal(layoutGraph(partial).positioned, false)
})

test('我的蓝图（bp.layout 字段）：分发器签名、函数分类和访问级别、继承变量', () => {
  const o: BpOutline = {
    ...OUTLINE,
    variables: [...OUTLINE.variables, { name: 'Health', type: 'Float', instanceEditable: true, inherited: true }],
    dispatchers: [{ name: 'OnHit', type: 'Multicast Delegate', params: [{ name: 'Damage', type: 'Float' }] }],
    graphs: [
      { name: 'Open', kind: 'function', nodes: 3, category: 'Door', access: 'private', const: true },
      { name: 'Close', kind: 'function', nodes: 3 },
    ],
  }
  const s = myBlueprint(o)
  const fns = s.find((x) => x.id === 'functions')!.items
  const open = fns.find((f) => f.name === 'Open')!
  assert.equal(open.category, 'Door')
  assert.equal(open.access, 'private')
  assert.equal(open.isConst, true)
  assert.deepEqual(
    byCategory(fns).map(([c, items]) => [c, items.map((i) => i.name)]),
    [
      ['', ['Close']],
      ['Door', ['Open']],
    ],
  )
  const vars = s.find((x) => x.id === 'variables')!.items
  assert.equal(vars.find((v) => v.name === 'Health')?.inherited, true)
  const d = s.find((x) => x.id === 'dispatchers')!.items[0]
  assert.equal(signature(d.params), '(Damage: Float)')
  assert.equal(signature(undefined), '()')
})
