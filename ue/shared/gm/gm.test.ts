// gm.json v2 契约、自定义 GM 组装成 gt.step、模块归属、表格路径换算。
// 用法：node --test ue/shared/gm/gm.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callStep, getQuery, invokesOf, mergeArgs, stepOk, callText } from './custom.ts'
import { allModules, placeOf } from './modules.ts'
import { emptyGm, GmCustom, parseGm } from './schema.ts'
import { pluginToStored, relInside, storedToAbs, storedToPlugin } from './table-path.ts'

const shop = { class: 'WBP_Shop_C', in: 'screen', ident: [{ prop: '@/TxtTitle.Text', op: 'eq', value: '杂货铺' }] }
const npc = { class: 'BP_ShopNpc_C', in: 'world', ident: [{ prop: '@.NpcId', op: 'eq', value: 2001 }] }
const buy = GmCustom.parse({
  id: 'c1a2',
  name: '杂货铺 · 买商品',
  module: 'shop',
  obj: '商店界面',
  objects: { 商店界面: { ref: shop }, 店主: { ref: npc } },
  function: 'BuyItem',
  args: { ItemId: 2003, Count: 1, Buyer: { $obj: '店主' } },
  editable: ['ItemId', 'Count'],
})

test('没有 version 2 的按空的新格式，旧 favGm / favConsole 不读', () => {
  assert.deepEqual(
    parseGm({ favGm: ['lua:X'], favConsole: ['stat fps'], macros: [{ id: 'm', name: 'm', steps: [] }] }),
    emptyGm(),
  )
  assert.deepEqual(parseGm(null), emptyGm())
  const g = parseGm({ version: 2, custom: [buy] })
  assert.equal(g.custom[0].kind, 'call')
  assert.equal(g.custom[0].many, 'error')
  assert.deepEqual(g.favs, { gm: [], engine: [], macro: [], objcall: [] })
  assert.throws(() => parseGm({ version: 2, objects: [{ name: '玩家' }] }), /ref 和 src/)
  assert.throws(
    () => parseGm({ version: 2, objects: [{ name: '玩家', src: '@pawn', ref: { class: 'X' } }] }),
    /ref 和 src/,
  )
})

test('调函数：objects 原样带上，步骤用 $obj，对象参数也在 objects 里', () => {
  const r = callStep(buy)
  assert.deepEqual(r.step, {
    action: 'obj.call',
    obj: { $obj: '商店界面' },
    function: 'BuyItem',
    args: { ItemId: 2003, Count: 1, Buyer: { $obj: '店主' } },
  })
  assert.deepEqual(r.objects, { 商店界面: shop, 店主: npc })
})

test('命中多个：first 给目标引用加 many，each 让 obj.call 带 each；原数据不改', () => {
  const first = callStep({ ...buy, many: 'first' })
  assert.equal((first.objects['商店界面'] as { many?: string }).many, 'first')
  assert.equal((first.objects['店主'] as { many?: string }).many, undefined)
  assert.equal((buy.objects['商店界面'].ref as { many?: string }).many, undefined)
  const each = callStep({ ...buy, many: 'each', part: 'Inner' })
  assert.equal(each.step.each, true)
  assert.equal(each.step.part, 'Inner')
})

test('来源字符串直接进 objects；用到不存在的对象报错', () => {
  const r = callStep({ ...buy, obj: '玩家', objects: { 玩家: { src: '@pawn' }, 店主: { ref: npc } } })
  assert.equal(r.objects['玩家'], '@pawn')
  assert.throws(() => callStep({ ...buy, objects: { 商店界面: { ref: shop } } }), /店主/)
})

test('执行时只能改 editable 的参数', () => {
  assert.deepEqual(mergeArgs(buy, { ItemId: 2005 }), { ItemId: 2005, Count: 1, Buyer: { $obj: '店主' } })
  assert.throws(() => mergeArgs(buy, { Buyer: '@pawn' }), /Buyer.*不能改/)
})

test('取对象：gt.resolve 带 show；来源字符串不支持', () => {
  const q = getQuery({ obj: '商店界面', objects: buy.objects, props: ['@/TxtTitle.Text'] })
  assert.deepEqual(q, { refs: [{ id: '商店界面', ref: shop }], show: ['@/TxtTitle.Text'] })
  assert.throws(() => getQuery({ obj: 'p', objects: { p: { src: '@pawn' } } }), /匹配规则/)
})

test('报告：invoke 单个和 each 的数组统一成数组；成败只看 ok / status', () => {
  assert.equal(invokesOf({ payload: { invoke: { returned: true } } }).length, 1)
  assert.equal(invokesOf({ payload: { invoke: [{}, {}] } }).length, 2)
  assert.equal(stepOk({ ok: true, status: 'passed' }), true)
  assert.equal(stepOk({ ok: false, status: 'failed', message: 'ok' }), false)
  assert.equal(callText(buy, buy.args), '在 商店界面 上调 BuyItem(2003, 1, 店主)')
})

test('模块：moduleOf 优先，否则分组第一段（自动模块），没分组的未归模块', () => {
  const g = { ...emptyGm(), modules: [{ id: 'shop', name: '商店' }], moduleOf: { 'lua:B': 'shop' } }
  assert.deepEqual(placeOf('lua:A', '商店/折扣', g), { module: 'shop', folders: ['折扣'] })
  assert.deepEqual(placeOf('lua:B', '背包', g), { module: 'shop', folders: [] })
  assert.deepEqual(placeOf('lua:C', '背包 / 整理', g), { module: '背包', folders: ['整理'] })
  assert.deepEqual(placeOf('lua:D', '', g), { folders: [] })
  const mods = allModules({ ...g, custom: [buy] }, ['shop', '背包', '任务'])
  assert.deepEqual(
    mods.map((m) => [m.id, !!m.auto]),
    [
      ['shop', false],
      ['任务', true],
      ['背包', true],
    ],
  )
})

test('表格路径：相对版本管理根存，外面的存绝对路径，旧的绝对路径照样能用', () => {
  const r = { base: 'D:/Work/Repo', panelDir: 'D:/Work/Repo/Client' }
  assert.equal(pluginToStored('Config/Item.xlsx', r), 'Client/Config/Item.xlsx')
  assert.equal(pluginToStored('E:/Design/Item.xlsx', r), 'E:/Design/Item.xlsx')
  assert.equal(storedToPlugin('Client/Config/Item.xlsx', r), 'Config/Item.xlsx')
  assert.equal(storedToPlugin('Docs/Item.xlsx', r), 'D:/Work/Repo/Docs/Item.xlsx')
  // 旧数据里的绝对路径（Windows 反斜杠、大小写不同）照样换得回去
  assert.equal(storedToPlugin('d:\\work\\repo\\Client\\Config\\Item.xlsx', r), 'Config/Item.xlsx')
  assert.equal(storedToAbs('a/../b.xlsx', '/r'), '/r/b.xlsx')
  assert.equal(relInside('/r/x', '/r/xy/a'), undefined)
  assert.equal(relInside('/r/x', '/r/x/a'), 'a')
})
