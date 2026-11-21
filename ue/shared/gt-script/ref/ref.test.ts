// v5 对象引用：写法、属性路径、in 成环、人话描述、引用收集和改名、离线校验的错误码（协议 game-test-ref 第 1–5、10 节）。
// 用法：node --test ue/shared/gt-script/ref/ref.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GtScript } from '../types.ts'
import { refSites, renameObject, unusedObjects, usesOf } from './collect.ts'
import { describeCheck, describeRef, describeTarget } from './describe.ts'
import { childOfPath, formatPropPath, oldPathHint, parsePropPath, rebasePath } from './path.ts'
import { classKey, findRefCycle, inWords, luaClassOf, refForm, shortClass, toTarget } from './ref.ts'
import { validateRefs, validateSettingsRefs } from './validate.ts'

test('三种写法和 target', () => {
  assert.equal(refForm('shop'), 'name')
  assert.equal(refForm('$found'), 'var')
  assert.equal(refForm({ class: 'WBP_Shop' }), 'inline')
  assert.equal(refForm({ ident: [] }), undefined)
  assert.deepEqual(toTarget('shop'), { obj: 'shop' })
  assert.deepEqual(toTarget({ obj: 'shop', part: 'BtnBuy' }), { obj: 'shop', part: 'BtnBuy' })
  assert.equal(toTarget(3), undefined)
  // U / A 前缀、_C 后缀、资源路径都认成同一个类
  assert.equal(classKey('/Game/UI/WBP_Shop.WBP_Shop_C'), classKey('WBP_Shop'))
  assert.equal(classKey('AShopNpc'), classKey('ShopNpc'))
  assert.equal(shortClass('/Game/UI/WBP_Shop.WBP_Shop_C'), 'WBP_Shop')
  // lua:模块名 按 Lua 继承链认；in 可以是数组
  assert.equal(luaClassOf('lua:UI/Shop/Shop'), 'UI/Shop/Shop')
  assert.equal(shortClass('lua:UI/Shop/Shop'), 'UI/Shop/Shop')
  assert.notEqual(classKey('lua:Shop'), classKey('Shop'))
  assert.deepEqual(inWords(['screen', 'lua']), ['screen', 'lua'])
  assert.deepEqual(inWords('@pawn'), [])
})

test('属性路径 v5：每段一个符号，旧写法给出新写法', () => {
  const p = (x: string) => {
    const r = parsePropPath(x)
    assert.ok(!('error' in r), `${x}：${'error' in r ? r.error : ''}`)
    return r
  }
  assert.deepEqual(p('@.ShopId'), { root: 'self', segs: [{ kind: 'prop', name: 'ShopId' }] })
  assert.deepEqual(p('@item#cfgId'), { root: 'item', segs: [{ kind: 'lua', name: 'cfgId' }] })
  assert.deepEqual(
    p('@/Header/TxtTitle:text').segs.map((x) => x.kind),
    ['child', 'child', 'state'],
  )
  assert.deepEqual(
    p('@/ShopComp.Goods[0].Id').segs.map((x) => x.kind),
    ['child', 'prop', 'index', 'prop'],
  )
  assert.deepEqual(p('@.GetName()').segs, [{ kind: 'fn', name: 'GetName' }])
  for (const x of ['@/ShopComp.Goods[0].Id', '@item.Data.ItemId', '@:text', '@#shopName', '@.Map["k"]'])
    assert.equal(formatPropPath(p(x)), x)
  for (const x of ['self.X', '@.A/B', '@:a.b', '@.a..b', '@[0]']) assert.ok('error' in parsePropPath(x), x)
  // 进了 Lua 之后只有表字段：.b 是 Lua 段，不能再调函数、接运行状态（和 C++ 一致）
  assert.deepEqual(
    p('@#a.b[1].c').segs.map((x) => x.kind),
    ['lua', 'lua', 'index', 'lua'],
  )
  assert.equal(formatPropPath(p('@/Panel#a.b')), '@/Panel#a.b')
  for (const x of ['@#a.b()', '@#a:text', '@#a.b:exists', '@#a#b']) assert.ok('error' in parsePropPath(x), x)
  assert.equal(oldPathHint('@self.ShopId'), '@.ShopId')
  assert.equal(oldPathHint('@lua.slot'), '@#slot')
  assert.equal(oldPathHint('@itemLua.id'), '@item#id')
  assert.equal(oldPathHint(':onScreen'), '@:onScreen')
  assert.equal(oldPathHint('@Header.TxtTitle:text'), '@/Header/TxtTitle:text')
  assert.equal(oldPathHint('@TxtTitle.Text'), '@/TxtTitle.Text')
  assert.equal(oldPathHint('@item.Data'), undefined)
  assert.equal(oldPathHint('@.X'), undefined)
  assert.equal(childOfPath('@/Header/TxtTitle.Text'), 'Header/TxtTitle')
  assert.equal(rebasePath('@.Text', 'Header.TxtTitle'), '@/Header/TxtTitle.Text')
  assert.equal(rebasePath('@:text', 'Btn'), '@/Btn:text')
  assert.equal(rebasePath('@/Btn:text', 'Btn'), '@/Btn:text')
})

test('objects 里的 in 成环', () => {
  assert.deepEqual(
    findRefCycle({
      a: { class: 'A', in: { obj: 'b', part: 'List' } },
      b: { class: 'B', in: { obj: { class: 'X', in: { obj: 'a' } } } },
      c: { class: 'C', in: { obj: 'a' } },
    }),
    ['a', 'b', 'a'],
  )
  assert.equal(findRefCycle({ a: { class: 'A' }, b: { class: 'B', in: { obj: 'a' } } }), undefined)
})

test('人话描述', () => {
  const shop = {
    class: 'WBP_Shop_C',
    ident: [
      { prop: '@/TxtTitle:text', op: 'eq', value: '杂货铺' },
      { prop: '@.ShopId', op: 'eq', value: 1001 },
    ],
  }
  assert.equal(
    describeRef(shop, { label: (p) => (p === '@/TxtTitle:text' ? '标题' : undefined) }),
    'WBP_Shop（标题 = 杂货铺，ShopId = 1001）',
  )
  assert.equal(describeRef(shop), 'WBP_Shop（TxtTitle 文字 = 杂货铺，ShopId = 1001）')
  const slot = {
    class: 'WBP_BagSlot',
    in: { obj: 'bag', part: 'ItemList' },
    ident: [{ prop: '@item.ItemId', value: 7 }],
  }
  assert.equal(describeRef(slot), 'WBP_BagSlot（item.ItemId = 7） · 在 bag 的 ItemList 里')
  assert.equal(describeRef('shop', { objects: { shop } }), 'shop · WBP_Shop')
  assert.equal(describeTarget({ obj: 'shop', part: 'Header.BtnClose' }), 'shop › Header.BtnClose')
  assert.equal(describeCheck({ obj: 'shop', prop: '@:onScreen', op: 'is', value: false }), 'shop 的 不在屏上')
  assert.equal(
    describeCheck(
      { obj: '$t', prop: '@/Msg:text', op: 'contains', value: '成功' },
      { t: (s) => (s === '包含' ? 'has' : s) },
    ),
    '$t 的 Msg 文字 has 成功',
  )
})

const v5: GtScript = {
  kind: 'gametest-scenario',
  schemaVersion: 5,
  objects: {
    shop: { class: 'WBP_Shop', in: ['screen', 'lua'], ident: [{ prop: '@.ShopId', op: 'eq', value: 1001 }] },
    npc: { class: 'lua:Npc/ShopNpc', in: 'all', ident: [{ prop: '@#npcId', value: 2001 }] },
    slot: { class: 'WBP_BagSlot', in: { obj: 'shop', part: 'ItemList' }, ident: [{ prop: '@item.ItemId', value: 3 }] },
  },
  guards: [
    {
      id: 'g1',
      when: { obj: { class: 'WBP_Guide' }, prop: '@:onScreen', op: 'is', value: true },
      do: [{ id: 's9', action: 'obj.close', obj: { class: 'WBP_Guide' } }],
    },
  ],
  steps: [
    { id: 's1', action: 'click', target: { obj: 'shop', part: 'Header.BtnBuy' } },
    { id: 's2', action: 'obj.wait', obj: 'shop', prop: '@/TxtTitle:text', op: 'contains', value: '杂货' },
    { id: 's3', action: 'obj.find', obj: 'slot', saveAs: 'it' },
    { id: 's4', action: 'click', target: { obj: '$it', part: 'BtnUse' } },
    {
      id: 'if1',
      action: 'if',
      cond: { all: [{ obj: 'shop', prop: '@/ItemList:count', op: 'between', value: [1, 3] }] },
      then: [],
    },
    { id: 's5', action: 'obj.call', obj: '@sub.QuestSubsystem', function: 'Accept', expect: { obj: 'shop' } },
    {
      id: 's6',
      action: 'obj.close',
      obj: 'shop',
      how: [
        { by: 'call', function: 'CloseShop' },
        { by: 'click', part: 'Header.BtnClose' },
      ],
    },
    { id: 's7', action: 'assert', expr: 'prop("shop", "@:text") == "x"' },
    { id: 's8', action: 'obj.set', obj: 'npc', prop: '@/ShopComp.bOpen', value: true },
  ],
}

test('写对了的 v5 场景没有问题', () => {
  assert.deepEqual(validateRefs(v5), [])
})

test('引用收集：每个写引用的地方，改名一起改', () => {
  const sites = refSites(v5)
  assert.deepEqual(
    usesOf(v5, 'shop').map((x) => `${x.role}:${x.path.join('.')}`),
    [
      'in:objects.slot.in.obj',
      'target:steps.0.target.obj',
      'obj:steps.1.obj',
      'check:steps.4.cond.all.0.obj',
      'check:steps.5.expect.obj',
      'obj:steps.6.obj',
    ],
  )
  assert.ok(sites.some((x) => x.role === 'check' && x.path.join('.') === 'guards.0.when.obj'))
  assert.deepEqual(unusedObjects(v5), [])
  const r = renameObject(v5, 'shop', 'store')!
  assert.ok(r.objects && 'store' in r.objects && !('shop' in r.objects))
  assert.equal(usesOf(r, 'store').length, 6)
  assert.equal(renameObject(v5, 'shop', 'slot'), undefined, '新名字被占用')
})

test('错误码：旧格式、旧写法、旧路径、引用、op 和类型', () => {
  const codes = (doc: GtScript) => validateRefs(doc).map((x) => `${x.code}@${x.at.join('.')}`)
  assert.deepEqual(codes({ schemaVersion: 4, steps: [] }), ['schema_old@schemaVersion'])
  assert.match(validateRefs({ schemaVersion: 4 })[0].message, /旧格式不再支持，请按新写法重写/)
  const bad: GtScript = {
    schemaVersion: 5,
    objects: {
      a: { class: 'A', in: { obj: 'b' } },
      b: { class: 'B', in: { obj: 'a' } },
      comp: { class: 'UHealthComponent' },
      named: 'a' as never,
      old: { class: 'BP_Npc', key: { NpcId: 1 }, in: 'widgets' },
      oldPath: {
        class: 'W',
        in: ['screen', 'nowhere'],
        ident: [
          { prop: '@self.Id', value: 1 },
          { prop: '@.A/B', value: 1 },
        ],
      },
      lua: { class: 'lua:' },
    },
    steps: [
      { id: 's1', action: 'click', target: 'WBP_Shop:Root/BtnBuy' },
      { id: 's2', action: 'click', target: { obj: 'nope', part: 'A/B' } },
      { id: 's3', action: 'invoke', object: '@sub.X', function: 'F' },
      { id: 's4', action: 'assert', cond: { target: 'WBP_X:.', visible: true } },
      { id: 's5', action: 'assert', expr: 'text("WBP_X:Root/T") == "a"' },
      { id: 's6', action: 'obj.wait', obj: { class: 'W', ident: [{ prop: '@:checked', op: 'eq', value: 'Checked' }] } },
      { id: 's7', action: 'obj.wait', obj: { class: 'W' }, prop: '@:count', op: 'between', value: 3 },
      { id: 's8', action: 'obj.wait', obj: { class: 'W' }, prop: '@:nope' },
      { id: 's9', action: 'obj.wait', obj: { class: 'W' }, prop: '@:text', op: 'bigger' },
      { id: 's10', action: 'wait', until: 'widgetGone', target: 'WBP_X:.' },
      { id: 's11', action: 'obj.set', obj: { class: 'W' }, prop: '@:text', value: 'x' },
      { id: 's12', action: 'obj.close', obj: { class: 'W' }, how: [{ by: 'click' }, { by: 'explode' }] },
      { id: 's13', action: 'click', target: { obj: { class: '', many: 'some' } } },
    ],
  }
  const got = codes(bad)
  for (const want of [
    'bad_type@objects.oldPath.in',
    'path_old@objects.oldPath.ident.0.prop',
    'path_syntax@objects.oldPath.ident.1.prop',
    'ref_bad_class@objects.lua.class',
    'ref_cycle@objects.a',
    'ref_need_owner@objects.comp',
    'bad_type@objects.named',
    'bad_type@objects.old.key',
    'bad_type@objects.old.in',
    'selector_removed@steps.0.target',
    'ref_not_found@steps.1.target.obj',
    'bad_type@steps.1.target.part',
    'action_removed@steps.2',
    'cond_removed@steps.3.cond',
    'expr_removed@steps.4.expr',
    'op_type@steps.5.obj.ident.0.op',
    'bad_type@steps.6.value',
    'bad_type@steps.7.prop',
    'op_unknown@steps.8.op',
    'action_removed@steps.9',
    'prop_readonly@steps.10.prop',
    'param_missing@steps.11.how.0',
    'bad_type@steps.11.how.1',
    'ref_bad_class@steps.12.target.obj.class',
    'bad_type@steps.12.target.obj.many',
  ])
    assert.ok(got.includes(want), `少了 ${want}：${got.join(' ')}`)
})

test('运行配置：旧字段报 settings_old，守护照场景查', () => {
  const r = validateSettingsRefs({
    itemKeys: [{ entry: 'WBP_Slot', by: ['ItemId'] }],
    guards: [
      { id: 'g1', when: { target: 'WBP_X:.', onScreen: true }, do: [{ action: 'widget.close', target: 'WBP_X:.' }] },
    ],
    identRules: [{ class: 'WBP_Slot' }, { class: 'WBP_Bag', ident: ['@self.Id'] }],
  })
  assert.deepEqual(r.map((x) => x.code).sort(), [
    'action_removed',
    'bad_type',
    'cond_removed',
    'path_old',
    'selector_removed',
    'settings_old',
  ])
})

test('Lua 字段后面调函数、接运行状态报 path_syntax', () => {
  const doc = {
    schemaVersion: 5,
    kind: 'scenario',
    steps: [
      { id: 's1', action: 'assert', cond: { obj: { class: 'W' }, prop: '@#a.b()', op: 'is', value: true } },
      { id: 's2', action: 'assert', cond: { obj: { class: 'W' }, prop: '@#a:text', op: 'eq', value: '' } },
      { id: 's3', action: 'assert', cond: { obj: { class: 'W' }, prop: '@#a.b', op: 'eq', value: 1 } },
    ],
  } as unknown as Parameters<typeof validateRefs>[0]
  const codes = validateRefs(doc)
    .filter((x) => x.code.startsWith('path_'))
    .map((x) => x.code)
  assert.deepEqual(codes, ['path_syntax', 'path_syntax'])
})
