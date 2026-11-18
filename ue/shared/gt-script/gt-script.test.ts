// GameTest 脚本 v3 数据层：路径、遍历、补 id、插入删除移动、放进移出块、包成块、展开、v1→v3、转回平铺、列表行。
// 用法：node --test ue/shared/gt-script/gt-script.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  duplicate,
  ensureIds,
  findPath,
  indent,
  insert,
  listRows,
  move,
  moveBy,
  outdent,
  parsePath,
  pathStr,
  placeOf,
  remove,
  replace,
  toFlat,
  toV3,
  unwrap,
  usedIds,
  walk,
  wrap,
  type GtScript,
} from './index.ts'

const click = (n: number) => ({ action: 'click', target: `W:Root/B${n}` })

const sample = (): GtScript => ({
  schemaVersion: 3,
  guards: [{ id: 'g1', when: { target: 'WBP_Guide:.', onScreen: true }, do: [{ action: 'key', key: 'E' }] }],
  steps: [
    { id: 's1', ...click(1) },
    {
      id: 'if1',
      action: 'if',
      cond: { target: 'W:Root/B2', visible: true },
      then: [{ id: 's2', ...click(2) }],
      elif: [{ cond: { expr: '1 > 0' }, then: [{ id: 's3', ...click(3) }] }],
      else: [{ id: 's4', ...click(4) }],
    },
    { id: 'loop1', action: 'loop', times: 3, do: [{ id: 's5', ...click(5) }] },
    { id: 's6', ...click(6) },
  ],
})

test('路径和字符串互转', () => {
  assert.deepEqual(parsePath('steps.3.do.0.then.1'), ['steps', 3, 'do', 0, 'then', 1])
  assert.equal(pathStr(['steps', 1, 'elif', 0, 'then', 0]), 'steps.1.elif.0.then.0')
})

test('遍历到块里、否则如果里和守护里的每一步', () => {
  const ids: string[] = []
  walk(sample(), (e) => void ids.push(`${e.step.id ?? e.step.action}@${e.depth}${e.inGuard ? 'g' : ''}`))
  assert.deepEqual(ids, ['s1@0', 'if1@0', 's2@1', 's3@1', 's4@1', 'loop1@0', 's5@1', 's6@0', 'key@0g'])
  assert.deepEqual(findPath(sample(), 's3'), ['steps', 1, 'elif', 0, 'then', 0])
})

test('拆出一步在哪：父块、槽的种类', () => {
  const p = placeOf(sample(), ['steps', 1, 'elif', 0, 'then', 0])!
  assert.deepEqual(p.parent, ['steps', 1])
  assert.equal(p.slotKind, 'elif')
  assert.equal(placeOf(sample(), ['guards', 0, 'do', 0])!.inGuard, true)
  assert.equal(placeOf(sample(), ['steps', 1, 'cond']), undefined)
})

test('补 id：按前缀接着已有的最大号往上数，块用自己的前缀', () => {
  const doc: GtScript = {
    steps: [
      { id: 's7', ...click(1) },
      click(2),
      { action: 'loop', times: 2, do: [click(3)] },
      { action: 'if', then: [] },
    ],
    guards: [{ when: {}, do: [] }],
  }
  const out = ensureIds(doc)
  assert.deepEqual(
    out.steps!.map((s) => s.id),
    ['s7', 's8', 'loop1', 'if1'],
  )
  assert.equal((out.steps![2].do as { id: string }[])[0].id, 's9')
  assert.equal(out.guards![0].id, 'g1')
  assert.equal(doc.steps![1].id, undefined, '不改传入的对象')
})

test('插入：新步骤重新发 id，不和已有的撞', () => {
  const r = insert(sample(), ['steps', 1, 'then'], 1, [{ id: 's1', ...click(9) }])!
  assert.deepEqual(r.path, ['steps', 1, 'then', 1])
  const ids = [...usedIds(r.doc)]
  assert.equal(ids.filter((x) => x === 's1').length, 1)
  assert.equal((r.doc.steps![1].then as { id: string }[])[1].id, 's7')
})

test('往没写的「否则」里插第一步：槽自动建出来', () => {
  const doc: GtScript = { steps: [{ id: 'if1', action: 'if', cond: {}, then: [] }] }
  const r = insert(doc, ['steps', 0, 'else'], 0, [click(1)])!
  assert.equal((r.doc.steps![0].else as unknown[]).length, 1)
})

test('删除：同时选了块和里面的步骤、跨槽都行', () => {
  const out = remove(sample(), [
    ['steps', 1, 'then', 0],
    ['steps', 1],
    ['steps', 3],
  ])!
  assert.deepEqual(
    out.steps!.map((s) => s.id),
    ['s1', 'loop1'],
  )
})

test('换一步：没带 id 时留原来的', () => {
  const r = replace(sample(), ['steps', 0], click(8))!
  assert.equal(r.doc.steps![0].id, 's1')
  assert.equal(r.doc.steps![0].target, 'W:Root/B8')
})

test('移动：同一槽往后挪、挪进另一个块、不能挪进自己', () => {
  let r = move(sample(), ['steps', 0], ['steps'], 3)!
  assert.deepEqual(
    r.doc.steps!.map((s) => s.id),
    ['if1', 'loop1', 's1', 's6'],
  )
  assert.deepEqual(r.path, ['steps', 2])
  // 前面的兄弟挪走后，目标槽的路径跟着变
  r = move(sample(), ['steps', 0], ['steps', 2, 'do'], 1)!
  assert.deepEqual(r.path, ['steps', 1, 'do', 1])
  assert.deepEqual(
    (r.doc.steps![1].do as { id: string }[]).map((s) => s.id),
    ['s5', 's1'],
  )
  assert.equal(move(sample(), ['steps', 2], ['steps', 2, 'do'], 0), undefined)
})

test('Alt+↑↓：兄弟换位，到边上就移出块', () => {
  let r = moveBy(sample(), ['steps', 3], -1)!
  assert.deepEqual(
    r.doc.steps!.map((s) => s.id),
    ['s1', 'if1', 's6', 'loop1'],
  )
  r = moveBy(sample(), ['steps', 2, 'do', 0], -1)!
  assert.deepEqual(r.path, ['steps', 2])
  assert.equal(r.doc.steps![2].id, 's5')
  r = moveBy(sample(), ['steps', 1, 'then', 0], 1)!
  assert.deepEqual(r.path, ['steps', 2])
  assert.equal(moveBy(sample(), ['steps', 0], -1), undefined)
})

test('Tab 放进上面的块（接在最后一个有内容的槽），Shift+Tab 移到父块后面', () => {
  let r = indent(sample(), ['steps', 2])!
  assert.deepEqual(r.path, ['steps', 1, 'else', 1])
  r = indent(sample(), ['steps', 3])!
  assert.deepEqual(r.path, ['steps', 2, 'do', 1])
  assert.equal(indent(sample(), ['steps', 1]), undefined, '上一个不是块')
  r = outdent(sample(), ['steps', 1, 'elif', 0, 'then', 0])!
  assert.deepEqual(r.path, ['steps', 2])
  assert.equal(r.doc.steps![2].id, 's3')
  assert.equal(outdent(sample(), ['steps', 0]), undefined)
  assert.equal(outdent(sample(), ['guards', 0, 'do', 0]), undefined)
})

test('包成块：同一槽里从第一个到最后一个；跨槽不行', () => {
  const r = wrap(
    sample(),
    [
      ['steps', 3],
      ['steps', 2],
    ],
    'loop',
  )!
  assert.deepEqual(r.path, ['steps', 2])
  const lp = r.doc.steps![2]
  assert.equal(lp.action, 'loop')
  assert.equal(lp.max, 30)
  assert.deepEqual(
    (lp.do as { id: string }[]).map((s) => s.id),
    ['loop1', 's6'],
  )
  assert.equal(lp.id, 'loop2')
  assert.equal(
    wrap(sample(), [
      ['steps', 0],
      ['steps', 1, 'then', 0],
    ]),
    undefined,
  )
  assert.equal(wrap(sample(), [['steps', 0]], 'click'), undefined)
})

test('展开：段和循环直接展开；if 有否则分支时不展开（会丢步骤）', () => {
  const r = unwrap(sample(), ['steps', 2])!
  assert.deepEqual(
    r.doc.steps!.map((s) => s.id),
    ['s1', 'if1', 's5', 's6'],
  )
  assert.equal(unwrap(sample(), ['steps', 1]), undefined)
  assert.equal(unwrap(sample(), ['steps', 0]), undefined)
})

test('复制一份：放在下面，里面的步骤都换新 id', () => {
  const r = duplicate(sample(), ['steps', 2])!
  assert.deepEqual(r.path, ['steps', 3])
  assert.equal(r.doc.steps![3].id, 'loop2')
  assert.equal((r.doc.steps![3].do as { id: string }[])[0].id, 's7')
})

test('v1 → v3：补 via:code、包成录制段、补 id', () => {
  const v1: GtScript = { name: 'x', steps: [click(1), { action: 'type', text: 'a' }, { action: 'key', key: 'E' }] }
  const out = toV3(v1, { wrapFlat: true, groupName: '录制' })
  assert.equal(out.schemaVersion, 3)
  assert.equal(out.kind, 'gametest-scenario')
  const g = out.steps![0]
  assert.equal(g.action, 'group')
  assert.equal(g.recorded, true)
  const inner = g.do as Record<string, unknown>[]
  assert.equal(inner[0].via, 'code')
  assert.equal(inner[1].via, 'code')
  assert.equal(inner[2].via, undefined)
  assert.deepEqual(
    inner.map((s) => s.id),
    ['s1', 's2', 's3'],
  )
  assert.equal(toV3(v1).steps!.length, 3, '保持平铺')
})

test('转回平铺：段展开；有如果、循环时列出来不转', () => {
  const doc: GtScript = {
    schemaVersion: 3,
    steps: [{ id: 'grp1', action: 'group', do: [click(1), { action: 'group', do: [click(2)] }] }, click(3)],
  }
  const r = toFlat(doc)
  assert.deepEqual(r.problems, [])
  assert.equal(r.doc!.steps!.length, 3)
  assert.equal(r.doc!.schemaVersion, 2)
  const bad = toFlat(sample())
  assert.deepEqual(
    bad.problems.map((p) => p.what),
    ['guards', 'if', 'loop'],
  )
})

test('列表行：否则如果 / 否则有分隔行、空槽有占位行、折叠后算出藏了几步', () => {
  const doc = sample()
  ;(doc.steps![2].do as unknown[]).length = 0
  const rows = listRows(doc, ['steps'], 'steps')
  assert.deepEqual(
    rows.map((r) => (r.kind === 'step' ? r.step.id : `${r.kind}:${r.slotKind}`)),
    ['s1', 'if1', 's2', 'slot:elif', 's3', 'slot:else', 's4', 'loop1', 'empty:do', 's6'],
  )
  const folded = listRows(sample(), ['steps'], 'steps', new Set(['if1']))
  const ifRow = folded.find((r) => r.kind === 'step' && r.step.id === 'if1')
  assert.equal(ifRow?.kind === 'step' && ifRow.hidden, 3)
  assert.equal(folded.length, 5)
})

test('能用的 $名字：参数、变量、set、saveAs、循环条目', async () => {
  const { scriptNames } = await import('./index.ts')
  const names = scriptNames({
    params: { account: { default: 'a' } },
    vars: { skipped: 0 },
    steps: [
      { action: 'set', var: 'gold0', value: 1 },
      { action: 'loop', each: 'W:List', max: 3, do: [{ action: 'api', api: 'Object.Find', saveAs: 'npc' }] },
    ],
  })
  assert.deepEqual(
    names.map((n) => n.name),
    ['account', 'skipped', 'gold0', 'index', 'item', 'npc'],
  )
})
