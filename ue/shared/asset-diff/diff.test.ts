/** 资源版本差异：属性按名字和值里的路径、组件按名字、节点按 GUID、伪代码按行比 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assetDiff, diffEmpty, leafDiffs, lineRows } from './diff.ts'
import type { AssetSnap } from './types.ts'

const node = (guid: string, title: string, pins: Record<string, string> = {}, links: string[] = []) => ({
  id: guid.slice(0, 8),
  guid,
  title,
  class: 'K2Node_CallFunction',
  pins,
  links,
})

const bp = (o: { angle: number; box: number[]; comps: string[]; delay: string; extra?: boolean }): AssetSnap => ({
  class: 'Blueprint',
  props: [
    { name: 'SurveyValidAngle', displayName: 'Survey Valid Angle', category: 'InteractingParam', value: o.angle },
    { name: 'SignificanceData', category: 'Significance', value: { MaxDistance: o.box[0], MinDistance: 100 } },
  ],
  blueprint: {
    parent: '/Script/Game.InteractableActor',
    interfaces: [],
    variables: o.extra ? [{ name: 'ResetCount', type: 'int', category: '', flags: [] }] : [],
    components: o.comps.map((n) => ({
      name: n,
      class: 'BoxComponent',
      parent: 'DefaultSceneRoot',
      source: 'scs' as const,
      props: [{ name: 'BoxExtent', value: { X: o.box[1], Y: 32, Z: 32 } }],
    })),
    graphs: [
      {
        name: 'EventGraph',
        kind: 'event',
        nodes: [
          node('aaaaaaaa1', 'Event BeginPlay', {}, ['then->bbbbbbbb.execute']),
          node('bbbbbbbb2', 'Delay', { Duration: o.delay }),
          ...(o.extra ? [node('cccccccc3', 'Print String', { InString: 'hi' })] : []),
        ],
        pseudo: ['event BeginPlay', `  Delay(Duration=${o.delay})`, ...(o.extra ? ['  PrintString("hi")'] : [])].join(
          '\n',
        ),
      },
      { name: 'OnInteract', kind: 'function', nodes: [], pseudo: 'function OnInteract' },
    ],
  },
})

test('蓝图：属性、结构体成员、组件增删、变量、节点和伪代码', () => {
  const a = bp({ angle: 90, box: [3000, 32], comps: ['ResetBox', 'HintText'], delay: '0.2' })
  const b = bp({ angle: 120, box: [4500, 48], comps: ['ResetBox', 'InteractHint'], delay: '0.5', extra: true })
  const d = assetDiff(a, b)
  assert.equal(d.blueprint, true)
  const angle = d.defaults.props.find((p) => p.name === 'SurveyValidAngle')!
  assert.deepEqual([angle.change, angle.a, angle.b, angle.label], ['mod', 90, 120, 'Survey Valid Angle'])
  const sig = d.defaults.props.find((p) => p.name === 'SignificanceData')!
  assert.deepEqual(sig.leaves, [{ path: 'MaxDistance', change: 'mod', a: 3000, b: 4500 }])
  assert.deepEqual(
    d.components.map((c) => [c.key, c.change, c.count]),
    [
      ['ResetBox', 'mod', 1],
      ['InteractHint', 'add', 0],
      ['HintText', 'del', 0],
    ],
  )
  assert.deepEqual(
    d.variables.map((v) => [v.name, v.change]),
    [['ResetCount', 'add']],
  )
  const g = d.graphs.find((x) => x.name === 'EventGraph')!
  assert.equal(g.change, 'mod')
  assert.deepEqual(
    g.added.map((n) => n.title),
    ['Print String'],
  )
  assert.deepEqual(
    g.modified.map((m) => [m.title, m.pins]),
    [['Delay', [{ pin: 'Duration', a: '0.2', b: '0.5' }]]],
  )
  assert.deepEqual(
    g.lines.filter((l) => l.kind !== 'ctx').map((l) => `${l.kind} ${l.text}`),
    ['del   Delay(Duration=0.2)', 'add   Delay(Duration=0.5)', 'add   PrintString("hi")'],
  )
  assert.equal(d.graphs.find((x) => x.name === 'OnInteract')!.change, 'same')
  assert.deepEqual(
    [d.stats.props, d.stats.compAdd, d.stats.compDel, d.stats.compMod, d.stats.vars, d.stats.graphs, d.stats.nodesAdd],
    [3, 1, 1, 1, 1, 1, 1],
  )
  assert.equal(diffEmpty(assetDiff(a, a)), true)
})

test('新建的文件：旧版是 null，整份算新加；数据表按行名比', () => {
  const dt = (rows: object[]): AssetSnap => ({
    class: 'DataTable',
    props: [],
    rows: JSON.stringify(rows),
    rowStruct: '/Script/G.Item',
  })
  const d = assetDiff(
    dt([
      { Name: 'Sword', Atk: 1 },
      { Name: 'Bow', Atk: 2 },
    ]),
    dt([
      { Name: 'Sword', Atk: 3 },
      { Name: 'Axe', Atk: 4 },
    ]),
  )
  assert.deepEqual(
    d.rows.map((r) => [r.key, r.change]),
    [
      ['Sword', 'mod'],
      ['Axe', 'add'],
      ['Bow', 'del'],
    ],
  )
  assert.equal(d.stats.rows, 3)
  const created = assetDiff(null, dt([]))
  assert.equal(created.created, true)
  assert.equal(created.defaults.change, 'add')
})

test('值里的数组、映射拆到具体那一处；伪代码远处的相同行折起来', () => {
  assert.deepEqual(leafDiffs({ L: [1, 2], M: { a: 1 } }, { L: [1, 3, 4], M: { b: 2 } }), [
    { path: 'L[1]', change: 'mod', a: 2, b: 3 },
    { path: 'L[2]', change: 'add', b: 4 },
    { path: 'M.a', change: 'del', a: 1 },
    { path: 'M.b', change: 'add', b: 2 },
  ])
  const a = Array.from({ length: 20 }, (_, i) => `line ${i}`)
  const b = [...a]
  b[10] = 'changed'
  const rows = lineRows(a.join('\n'), b.join('\n'))
  assert.equal(rows[0].kind, 'hunk')
  assert.equal(rows.filter((r) => r.kind === 'ctx').length, 6)
  assert.deepEqual(
    rows.filter((r) => r.kind === 'add'),
    [{ kind: 'add', text: 'changed', n: 11 }],
  )
})
