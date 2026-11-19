// AssetForge 配置读取层：关键帧简写、样式、按段找 / 换 / 排、include 展开。
// 用法：node --test ue/shared/forge-doc/forge-doc.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyStyles,
  expandConfig,
  findSections,
  HEAD,
  lineOf,
  normalizeAnimations,
  normalizeKey,
  orderSections,
  originAt,
  parseLocated,
  replaceSection,
  resolveInclude,
  resolveStyles,
  sectionIds,
  sectionText,
  sourceOf,
} from './index.ts'

const IDS = sectionIds(undefined, 'umg-widget')

test('关键帧简写和对象写法等价', () => {
  assert.deepEqual(normalizeKey([0.3, 0.85, 'cubic']), { time: 0.3, value: 0.85, interp: 'cubic' })
  assert.deepEqual(normalizeKey([0, 1]), { time: 0, value: 1 })
  assert.deepEqual(normalizeKey({ time: 0.3, value: 0.85, interp: 'cubic' }), {
    time: 0.3,
    value: 0.85,
    interp: 'cubic',
  })
  assert.equal(normalizeKey(['a', 1]), undefined)
  const a = normalizeAnimations([
    {
      name: 'In',
      tracks: [{ target: 'Root/A', channel: 'RenderOpacity', keys: [[0, 0], { time: 1, value: 1 }, 'bad'] }],
    },
  ])
  assert.deepEqual(a[0].tracks[0].keys, [
    { time: 0, value: 0 },
    { time: 1, value: 1 },
  ])
})

test('样式：数组后面的覆盖前面的，节点自己写的覆盖样式', () => {
  const styles = { A: { props: { X: 1, Y: 1 }, slot: { P: 1 } }, B: { props: { Y: 2 } } }
  const s = applyStyles({ style: ['A', 'B', 'Nope'], props: { X: 9 } }, styles)
  assert.deepEqual(s.props, { X: 9, Y: 2 })
  assert.deepEqual(s.slot, { P: 1 })
  assert.deepEqual(s.propFrom, { y: 'B' })
  assert.deepEqual(s.missing, ['Nope'])
  const root = { name: 'R', children: [{ name: 'C', style: 'A' }, { name: 'D' }] }
  const r = resolveStyles(root, styles)
  assert.deepEqual((r.children[0] as unknown as { props: unknown }).props, { X: 1, Y: 1 })
  assert.equal(r.children[1], root.children[1])
  const plain = { name: 'R', children: [{ name: 'D' }] }
  assert.equal(resolveStyles(plain, styles), plain)
})

test('样式：结构体逐层合并，数组整体替换，字段名大小写和 b 前缀不敏感', () => {
  const styles = { S: { props: { Padding: { Left: 1, Top: 2 }, bIsVariable: true, Tags: [1, 2] } } }
  const s = applyStyles({ style: 'S', props: { padding: { Left: 9 }, IsVariable: false, Tags: [3] } }, styles)
  assert.deepEqual(s.props, { padding: { Top: 2, Left: 9 }, IsVariable: false, Tags: [3] })
})

test('带注释解析，记下每个路径的行', () => {
  const src = '{\n  // c\n  "a": 1,\n  "b": {\n    "c": [1, 2]\n  },\n}'
  const p = parseLocated(src)
  assert.deepEqual(p.value, { a: 1, b: { c: [1, 2] } })
  assert.equal(lineOf(p.lines, ['a']), 3)
  assert.equal(lineOf(p.lines, ['b', 'c', 1]), 5)
  assert.equal(lineOf(p.lines, ['b', 'zz']), 4)
  assert.throws(() => parseLocated('{\n "a": 1\n "b": 2}'), /第 3 行/)
})

const DOC = `{
  // 头
  "kind": "umg-widget",
  "asset": "/Game/UI/WBP_X",
  "root": {
    "class": "Overlay"
  },
  "animations": [
    { "name": "In", "tracks": [] }
  ], // 动画
  "styles": { "A": {} },
  "revision": 3
}
`

test('按段找行号范围', () => {
  const s = findSections(DOC, IDS)
  assert.deepEqual(
    s.map((x) => [x.id, x.startLine, x.endLine, x.contiguous]),
    [
      [HEAD, 2, 12, false],
      ['root', 5, 7, true],
      ['animations', 8, 10, true],
      ['styles', 11, 11, true],
    ],
  )
  assert.equal(sectionText(DOC, 'root', IDS), '"root": {\n    "class": "Overlay"\n  }')
  assert.throws(() => sectionText(DOC, HEAD, IDS), /隔开/)
})

test('只换一段，其他字节不动', () => {
  const next = replaceSection(DOC, 'animations', '"animations": []', IDS)
  assert.equal(next, DOC.replace('[\n    { "name": "In", "tracks": [] }\n  ]', '[]'))
  assert.throws(() => replaceSection(DOC, 'animations', '"root": {}', IDS), /不能有字段 root/)
  assert.throws(() => replaceSection(DOC, 'animations', '"animations": [', IDS), /读不懂/)
})

test('没有的段按顺序插进去', () => {
  const src = '{\n  "kind": "umg-widget",\n  "root": {}\n}'
  const a = replaceSection(src, 'animations', '"animations": []', IDS)
  assert.equal(a, '{\n  "kind": "umg-widget",\n  "root": {},\n  "animations": []\n}')
  const b = replaceSection(src, 'styles', '"styles": {}', IDS)
  assert.equal(b, '{\n  "kind": "umg-widget",\n  "styles": {},\n  "root": {}\n}')
  assert.deepEqual(parseLocated(b).value, { kind: 'umg-widget', styles: {}, root: {} })
})

test('按段顺序重排，注释跟着字段走，内容不动', () => {
  const out = orderSections(DOC, IDS)
  const v = parseLocated(out).value as Record<string, unknown>
  assert.deepEqual(Object.keys(v), ['kind', 'revision', 'asset', 'styles', 'root', 'animations'])
  assert.deepEqual(v, parseLocated(DOC).value)
  assert.ok(out.includes('// 头\n  "kind"'))
  assert.ok(out.includes('] // 动画'))
  assert.equal(orderSections(out, IDS), out)
  assert.ok(findSections(out, IDS).every((s) => s.contiguous))
})

test('schema 里登记的段优先', () => {
  assert.deepEqual(sectionIds({ sections: ['head', 'root', { name: 'variables' }] }), ['root', 'variables'])
  assert.deepEqual(sectionIds({ 'x-forge': { sections: [{ id: 'rows' }] } }), ['rows'])
  assert.deepEqual(sectionIds({}), ['styles', 'root'])
  assert.deepEqual(sectionIds(undefined, 'state-tree').slice(2), [
    'parameters',
    'evaluators',
    'globalTasks',
    'bindings',
  ])
  assert.deepEqual(
    sectionIds({
      'x-forge': { sections: [{ name: 'header' }, { name: 'styles' }, { name: 'root' }, { name: 'animations' }] },
    }),
    ['styles', 'root', 'animations'],
  )
})

test('include 路径相对引用它的文件，不能出配置根', () => {
  assert.equal(resolveInclude('umg/UI/WBP_A.json', 'WBP_A.parts/x.json'), 'umg/UI/WBP_A.parts/x.json')
  assert.equal(resolveInclude('umg/UI/WBP_A.parts/x.json', '../y.json'), 'umg/UI/y.json')
  assert.equal(resolveInclude('a.json', '../x.json'), undefined)
  assert.equal(resolveInclude('a.json', '/etc/x.json'), undefined)
})

const FILES: Record<string, string> = {
  'umg/W.json': JSON.stringify({
    kind: 'umg-widget',
    root: {
      class: 'Overlay',
      name: 'Root',
      children: [{ include: 'W.parts/side.json' }, { class: 'Text', name: 'T' }],
    },
    animations: { include: 'W.parts/anim.json' },
  }),
  'umg/W.parts/side.json':
    '{ "fragment": "node", "node": [{ "class": "A", "name": "A", "children": [{ "include": "inner.json" }] }, { "class": "B", "name": "B" }] }',
  'umg/W.parts/inner.json': '{ "fragment": "node", "node": { "class": "I", "name": "I" } }',
  'umg/W.parts/anim.json': '{\n  "fragment": "animations",\n  "animations": [{ "name": "In", "tracks": [] }]\n}',
}
const reader = (files: Record<string, string>) => async (f: string) => files[f]

test('include 展开：节点数组拆成兄弟节点，段整段换掉，记下来源', async () => {
  const e = await expandConfig('umg/W.json', reader(FILES))
  assert.deepEqual(e.errors, [])
  const doc = e.doc as { root: { children: { name: string; children?: { name: string }[] }[] }; animations: unknown }
  assert.deepEqual(
    doc.root.children.map((c) => c.name),
    ['A', 'B', 'T'],
  )
  assert.equal(doc.root.children[0].children![0].name, 'I')
  assert.deepEqual(doc.animations, [{ name: 'In', tracks: [] }])
  assert.deepEqual(sourceOf(e, ['root', 'children', 2, 'props', 'Text'], 'umg/W.json'), {
    file: 'umg/W.json',
    path: ['root', 'children', 1, 'props', 'Text'],
  })
  assert.deepEqual(sourceOf(e, ['root', 'children', 1, 'name'], 'umg/W.json'), {
    file: 'umg/W.parts/side.json',
    path: ['node', 1, 'name'],
  })
  assert.deepEqual(sourceOf(e, ['animations', 0], 'umg/W.json'), {
    file: 'umg/W.parts/anim.json',
    path: ['animations', 0],
  })
  assert.equal(originAt(e, ['root', 'children', 1])?.file, 'umg/W.parts/side.json')
  assert.equal(originAt(e, ['root', 'children', 0, 'children', 0])?.file, 'umg/W.parts/inner.json')
  assert.equal(originAt(e, ['root', 'children', 2]), undefined)
  assert.equal(originAt(e, ['animations', 0, 'name'])?.kind, 'section')
})

test('include 出错：成环、放错位置、不是片段、文件不在，原样留着并报错', async () => {
  const bad = {
    'a.json': JSON.stringify({
      kind: 'umg-widget',
      root: {
        class: 'O',
        children: [
          { include: 'loop.json' },
          { include: 'anim.json' },
          { include: 'res.json' },
          { include: 'none.json' },
        ],
      },
      styles: { include: 'node.json' },
    }),
    'loop.json': '{ "fragment": "node", "node": { "class": "L", "children": [{ "include": "loop.json" }] } }',
    'anim.json': '{ "fragment": "animations", "animations": [] }',
    'res.json': '{ "kind": "umg-widget" }',
    'node.json': '{ "fragment": "node", "node": {} }',
  }
  const e = await expandConfig('a.json', reader(bad))
  const all = e.errors.join('\n')
  assert.match(all, /成环：a\.json → loop\.json → loop\.json/)
  assert.match(all, /anim\.json 是动画片段，不能 include 到控件树里/)
  assert.match(all, /res\.json 是资源配置/)
  assert.match(all, /none\.json 不存在/)
  assert.match(all, /node\.json 是节点片段，不能当 styles 段/)
  assert.deepEqual((e.doc as { styles: unknown }).styles, { include: 'node.json' })
})

test('include 的规矩和 UEKit 一致：头字段不能 include，片段不能有多余字段，段片段能再 include 同段', async () => {
  const files = {
    'a.json': JSON.stringify({
      kind: 'umg-widget',
      parent: { include: 'p.json' },
      root: { class: 'O' },
      animations: { include: 'a1.json' },
      styles: { include: 'bad.json' },
    }),
    'p.json': '{ "fragment": "parent", "parent": "x" }',
    'a1.json': '{ "fragment": "animations", "animations": { "include": "a2.json" } }',
    'a2.json': '{ "fragment": "animations", "$schema": "s", "animations": [1] }',
    'bad.json': '{ "fragment": "styles", "styles": {}, "kind": "x" }',
  }
  const e = await expandConfig('a.json', reader(files))
  const all = e.errors.join('\n')
  assert.match(all, /头字段 parent 不能 include/)
  assert.match(all, /bad\.json 是资源配置/)
  assert.deepEqual((e.doc as { animations: unknown }).animations, [1])
  assert.equal(originAt(e, ['animations', 0])?.file, 'a2.json')
  const files2 = {
    'b.json': JSON.stringify({ kind: 'umg-widget', styles: { include: 's.json' } }),
    's.json': '{ "fragment": "styles", "styles": {}, "extra": 1 }',
  }
  const e2 = await expandConfig('b.json', reader(files2))
  assert.match(e2.errors.join(''), /不能有 extra/)
})

test('同一个片段被引用两次给警告', async () => {
  const files = {
    'a.json': JSON.stringify({
      kind: 'k',
      root: { class: 'O', children: [{ include: 'n.json' }, { include: 'n.json' }] },
    }),
    'n.json': '{ "fragment": "node", "node": { "class": "N" } }',
  }
  const e = await expandConfig('a.json', reader(files))
  assert.equal(e.errors.length, 0)
  assert.match(e.warnings.join(''), /不止一次/)
})
