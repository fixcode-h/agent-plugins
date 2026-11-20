// 子界面（ref）嫁接、防环、限深度、Switcher 当前页的单测：node --test ue/web/inspect/layouts/umg/subref/subref.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setHost } from '../../../../host.ts'
import { layoutTree } from '../approx.ts'
import { countNodes, fromConfig, type UmgConfig } from '../config.ts'
import { indexTree, type WNode } from '../model.ts'
import { paintOf } from '../paint.ts'
import { liveRefIssues, previewPages, rectOrAncestor } from './preview.ts'
import { graftRefs, loadSubConfigs, MAX_REF_DEPTH, refCandidates, type LoadConfig } from './refs.ts'

setHost({
  t: (zh: string, v?: Record<string, string | number>) => zh.replace(/\{(\w+)\}/g, (_, k: string) => String(v?.[k])),
} as never)

const page = (name: string, text: string, extra: object = {}): UmgConfig => ({
  kind: 'umg-widget',
  root: {
    class: 'VerticalBox',
    name: `${name}Root`,
    children: [{ class: 'TextBlock', name: `${name}Title`, props: { Text: text, Font: { Size: 20 } } }],
    ...extra,
  },
})

/** 父界面：Overlay 里一个 Switcher，三页都是 ref（第二页指向不存在的文件） */
const MAIN: UmgConfig = {
  kind: 'umg-widget',
  root: {
    class: 'Overlay',
    name: 'Root',
    children: [
      {
        class: 'WidgetSwitcher',
        name: 'Pages',
        slot: { HorizontalAlignment: 'HAlign_Fill', VerticalAlignment: 'VAlign_Fill' },
        children: [
          { name: 'Page_Home', ref: './pages/Home.json' },
          { name: 'Page_Bag', ref: './pages/Bag.json' },
          { name: 'Page_Gone', ref: './pages/Gone.json' },
        ],
      },
    ],
  },
}

const FILES: Record<string, UmgConfig> = {
  'umg/pages/Home.json': page('Home', '首页'),
  // 背包页里再挂一个子界面（递归），还反过来引用父界面（成环）
  'umg/pages/Bag.json': {
    kind: 'umg-widget',
    root: {
      class: 'VerticalBox',
      name: 'BagRoot',
      children: [
        { class: 'TextBlock', name: 'BagTitle', props: { Text: '背包' } },
        { name: 'Slot_Item', ref: './Item.json' },
        { name: 'Back', ref: '../Main.json' },
      ],
    },
  },
  'umg/pages/Item.json': page('Item', '道具'),
}

const fakeLoad =
  (files: Record<string, UmgConfig>, seen: string[] = []): LoadConfig =>
  async (f) => {
    seen.push(f)
    if (f === 'umg/Main.json') return MAIN
    const d = files[f]
    if (!d) throw new Error(`文件不存在：${f}`)
    return d
  }

const find = (n: WNode, name: string): WNode | undefined =>
  n.name === name ? n : n.children.map((c) => find(c, name)).find(Boolean)

test('ref 路径先按引用它的配置所在目录，再按配置根；出了配置根的不要', () => {
  assert.deepEqual(refCandidates('umg/WBP_A.json', './pages/B.json'), ['umg/pages/B.json', 'pages/B.json'])
  assert.deepEqual(refCandidates('WBP_A.json', 'pages/B.json'), ['pages/B.json'])
  assert.deepEqual(refCandidates('umg/A.json', '../../x.json'), [])
  assert.deepEqual(refCandidates('umg/A.json', 'B.txt'), [])
})

test('子配置递归读、同一份文件只读一次，读不到的记原因', async () => {
  const seen: string[] = []
  const subs = await loadSubConfigs('umg/Main.json', MAIN, fakeLoad(FILES, seen))
  assert.equal(subs.get('umg/Main.json\n./pages/Home.json')?.file, 'umg/pages/Home.json')
  assert.equal(subs.get('umg/pages/Bag.json\n./Item.json')?.file, 'umg/pages/Item.json')
  // 两个候选都试过，记第一个候选的原因
  assert.match(subs.get('umg/Main.json\n./pages/Gone.json')?.error ?? '', /文件不存在：umg\/pages\/Gone.json/)
  assert.equal(seen.filter((f) => f === 'umg/Main.json').length, 1, '成环也只读一次、不会死循环')
})

test('嫁接：子界面的根成了子界面节点唯一的子控件，key 接着父路径、标来源文件、去掉 at', async () => {
  const subs = await loadSubConfigs('umg/Main.json', MAIN, fakeLoad(FILES))
  const tree = graftRefs(fromConfig(MAIN.root!), 'umg/Main.json', subs)
  const home = find(tree, 'Page_Home')!
  assert.equal(home.subFile, 'umg/pages/Home.json')
  assert.equal(home.children[0].key, 'Root/Pages/Page_Home/HomeRoot')
  assert.equal(home.children[0].src, 'umg/pages/Home.json')
  assert.equal(home.children[0].children[0].at, undefined)
  assert.deepEqual(paintOf(home), {}, '嫁接了就不再画斜线占位')
  // 递归：背包页里的道具子界面也展开；反过来引用父界面的标成环
  const bag = find(tree, 'Page_Bag')!
  assert.equal(find(bag, 'ItemTitle')?.src, 'umg/pages/Item.json')
  assert.match(find(bag, 'Back')?.refError ?? '', /引用成环：umg\/Main.json → umg\/pages\/Bag.json → umg\/Main.json/)
  // 读不到的：占位框写原因
  const gone = find(tree, 'Page_Gone')!
  assert.match(gone.refError ?? '', /文件不存在/)
  const p = paintOf(gone)
  assert.ok(p.missing && p.text?.includes('文件不存在'))
  // 控件个数只数自己的
  assert.equal(countNodes(tree), 5)
})

test('近似预览：子界面里的控件排进子界面节点的格子', async () => {
  const subs = await loadSubConfigs('umg/Main.json', MAIN, fakeLoad(FILES))
  const tree = graftRefs(fromConfig(MAIN.root!), 'umg/Main.json', subs)
  const rects = layoutTree(tree, 800, 600)
  const home = rects.find((r) => r.key === 'Root/Pages/Page_Home')
  const title = rects.find((r) => r.key === 'Root/Pages/Page_Home/HomeRoot/HomeTitle')
  assert.ok(home && title)
  assert.deepEqual([home.w, home.h], [800, 600])
  assert.ok(title.w > 0 && title.h > 0 && title.x >= home.x && title.y >= home.y)
  // 别的页不排（Switcher 只画当前页）
  assert.equal(
    rects.some((r) => r.key.startsWith('Root/Pages/Page_Bag')),
    false,
  )
})

test('嵌套太深的子界面不再展开', async () => {
  const files: Record<string, UmgConfig> = {}
  for (let i = 0; i < MAX_REF_DEPTH + 3; i++)
    files[`L${i}.json`] = {
      kind: 'umg-widget',
      root: { class: 'Overlay', name: `L${i}`, children: [{ name: `R${i}`, ref: `L${i + 1}.json` }] },
    }
  const main = files['L0.json']
  const subs = await loadSubConfigs('L0.json', main, fakeLoad(files))
  const tree = graftRefs(fromConfig(main.root!), 'L0.json', subs)
  let n: WNode | undefined = tree
  let depth = 0
  while (n && !n.refError && n.children.length) {
    n = n.children[0]
    if (n.ref) depth++
  }
  assert.ok(n?.refError, '最深处标了原因')
  assert.ok(depth <= MAX_REF_DEPTH + 1)
})

test('不知道配置根时 ref 节点只标原因；没有 ref 的树原样返回', () => {
  const tree = fromConfig(MAIN.root!)
  assert.match(find(graftRefs(tree, undefined, undefined), 'Page_Home')?.refError ?? '', /不知道配置根/)
  const plain = fromConfig({ class: 'Overlay', name: 'Root', children: [{ class: 'TextBlock', name: 'T' }] })
  assert.equal(graftRefs(plain, undefined, undefined), plain)
  assert.equal(graftRefs(plain, 'a.json', new Map()), plain)
})

test('WidgetSwitcher：选中另一页（或页里的控件）时切到那一页，选别处原样返回', async () => {
  const subs = await loadSubConfigs('umg/Main.json', MAIN, fakeLoad(FILES))
  const tree = graftRefs(fromConfig(MAIN.root!), 'umg/Main.json', subs)
  assert.equal(previewPages(tree, undefined), tree)
  assert.equal(previewPages(tree, 'Root/Pages'), tree)
  assert.equal(previewPages(tree, 'Root/Pages/Page_Home/HomeRoot/HomeTitle'), tree, '已经是当前页')
  const bag = previewPages(tree, 'Root/Pages/Page_Bag/BagRoot/BagTitle')
  assert.notEqual(bag, tree)
  assert.equal(find(bag, 'Pages')?.active, 1)
  const rects = layoutTree(bag, 800, 600)
  assert.ok(rects.some((r) => r.key === 'Root/Pages/Page_Bag/BagRoot/BagTitle'))
  assert.equal(
    rects.some((r) => r.key.startsWith('Root/Pages/Page_Home')),
    false,
  )
  // 配置写了 ActiveWidgetIndex：选中那一页不算切页
  const two = fromConfig({
    class: 'WidgetSwitcher',
    name: 'S',
    props: { ActiveWidgetIndex: 1 },
    children: [
      { class: 'Border', name: 'A' },
      { class: 'Border', name: 'B' },
    ],
  })
  assert.equal(previewPages(two, 'S/B'), two)
  assert.equal(previewPages(two, 'S/A').active, 0)
})

test('选中框：没有矩形时框住最近的有矩形的祖先', () => {
  const tree = fromConfig({
    class: 'Overlay',
    name: 'R',
    children: [{ class: 'Border', name: 'P', children: [{ class: 'TextBlock', name: 'T' }] }],
  })
  const idx = indexTree(tree)
  const rects = new Map([['R/P', { key: 'R/P', x: 1, y: 2, w: 3, h: 4 }]])
  assert.equal(rectOrAncestor('R/P/T', rects, idx.parent)?.key, 'R/P')
  assert.equal(rectOrAncestor('R', rects, idx.parent), undefined)
})

test('UE 的控件树里子界面对不上时说明原因', () => {
  const cfg = fromConfig(MAIN.root!)
  const live = fromConfig({
    class: 'Overlay',
    name: 'Root',
    children: [
      {
        class: 'WidgetSwitcher',
        name: 'Pages',
        children: [
          { name: 'Page_Home', ref: 'x.json' },
          { class: 'Border', name: 'Page_Bag' },
        ],
      },
    ],
  })
  const notes = liveRefIssues(cfg, live)
  assert.equal(notes.length, 2)
  assert.match(notes[0], /Page_Bag 在 UE 里不是子界面（是 Border）/)
  assert.match(notes[1], /Page_Gone 在 UE 的控件树里没有/)
})
