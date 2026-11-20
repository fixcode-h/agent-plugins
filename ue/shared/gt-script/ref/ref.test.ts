// v4 对象引用：写法、属性路径、in 成环、人话描述、引用收集和改名、离线校验的错误码（协议 game-test-ref 第 1–5、10 节）。
// 用法：node --test ue/shared/gt-script/ref/ref.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GtScript } from '../types.ts'
import { refSites, renameObject, unusedObjects, usesOf } from './collect.ts'
import { describeCheck, describeRef, describeTarget } from './describe.ts'
import { formatPropPath, parsePropPath, partOfProp } from './prop-path.ts'
import { classKey, findRefCycle, refForm, shortClass, toTarget } from './ref.ts'
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
})

test('属性路径：根、部件、Lua、状态', () => {
  const p = (s: string) => {
    const r = parsePropPath(s)
    assert.ok('path' in r, `${s}：${'error' in r ? r.error : ''}`)
    return r.path
  }
  assert.deepEqual(p('@self.ShopId'), { root: 'self', segs: ['ShopId'] })
  assert.deepEqual(p('@item.Data.Items[0]["k"]'), { root: 'item', segs: ['Data', 'Items[0]["k"]'] })
  assert.deepEqual(p(':onScreen'), { root: 'self', segs: [], state: 'onScreen' })
  assert.deepEqual(p('@Header.TxtTitle:TEXT'), { root: 'named', segs: ['Header', 'TxtTitle'], state: 'text' })
  assert.deepEqual(p('@Header.lua.title'), { root: 'named', segs: ['Header', 'lua', 'title'], luaAt: 1 })
  assert.equal(partOfProp(p('@Header.TxtTitle:text')), 'Header.TxtTitle')
  assert.equal(partOfProp(p('@Header.lua.title')), 'Header')
  assert.equal(formatPropPath(p(':shown')), ':shown')
  assert.equal(formatPropPath(p('@ITEMLUA.id')), '@itemLua.id')
  for (const [s, e] of [
    ['', 'empty'],
    ['self.X', 'no_at'],
    [':nope', 'unknown_state'],
    ['@a..b', 'bad_seg'],
    ['@self', 'bad_seg'],
  ])
    assert.deepEqual(parsePropPath(s), { error: e }, s)
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
      { prop: '@TxtTitle:text', op: 'eq', value: '杂货铺' },
      { prop: '@self.ShopId', op: 'eq', value: 1001 },
    ],
  }
  assert.equal(
    describeRef(shop, { label: (p) => (p === '@TxtTitle:text' ? '标题' : undefined) }),
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
  assert.equal(describeCheck({ obj: 'shop', prop: ':onScreen', op: 'is', value: false }), 'shop 的 不在屏上')
  assert.equal(
    describeCheck(
      { obj: '$t', prop: '@Msg:text', op: 'contains', value: '成功' },
      { t: (s) => (s === '包含' ? 'has' : s) },
    ),
    '$t 的 Msg 文字 has 成功',
  )
})

const v4: GtScript = {
  kind: 'gametest-scenario',
  schemaVersion: 4,
  objects: {
    shop: { class: 'WBP_Shop', ident: [{ prop: '@self.ShopId', op: 'eq', value: 1001 }] },
    slot: { class: 'WBP_BagSlot', in: { obj: 'shop', part: 'ItemList' }, ident: [{ prop: '@item.ItemId', value: 3 }] },
  },
  guards: [
    {
      id: 'g1',
      when: { obj: { class: 'WBP_Guide' }, prop: ':onScreen', op: 'is', value: true },
      do: [{ id: 's9', action: 'obj.close', obj: { class: 'WBP_Guide' } }],
    },
  ],
  steps: [
    { id: 's1', action: 'click', target: { obj: 'shop', part: 'Header.BtnBuy' } },
    { id: 's2', action: 'obj.wait', obj: 'shop', prop: '@TxtTitle:text', op: 'contains', value: '杂货' },
    { id: 's3', action: 'obj.find', obj: 'slot', saveAs: 'it' },
    { id: 's4', action: 'click', target: { obj: '$it', part: 'BtnUse' } },
    {
      id: 'if1',
      action: 'if',
      cond: { all: [{ obj: 'shop', prop: ':count', op: 'between', value: [1, 3] }] },
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
    { id: 's7', action: 'assert', expr: 'prop("shop", ":text") == "x"' },
  ],
}

test('写对了的 v4 场景没有问题', () => {
  assert.deepEqual(validateRefs(v4), [])
})

test('引用收集：每个写引用的地方，改名一起改', () => {
  const sites = refSites(v4)
  assert.deepEqual(
    usesOf(v4, 'shop').map((x) => `${x.role}:${x.path.join('.')}`),
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
  assert.deepEqual(unusedObjects(v4), [])
  const r = renameObject(v4, 'shop', 'store')!
  assert.ok(r.objects && 'store' in r.objects && !('shop' in r.objects))
  assert.equal(usesOf(r, 'store').length, 6)
  assert.equal(renameObject(v4, 'shop', 'slot'), undefined, '新名字被占用')
})

test('错误码：旧格式、旧写法、引用、op 和类型、迁移待定', () => {
  const codes = (doc: GtScript) => validateRefs(doc).map((x) => `${x.code}@${x.at.join('.')}`)
  assert.deepEqual(codes({ schemaVersion: 3, steps: [] }), ['schema_old@schemaVersion'])
  const bad: GtScript = {
    schemaVersion: 4,
    todo: '变量 x 待定',
    objects: {
      a: { class: 'A', in: { obj: 'b' } },
      b: { class: 'B', in: { obj: 'a' } },
      comp: { class: 'UHealthComponent' },
      named: 'a' as never,
      old: { class: 'BP_Npc', key: { NpcId: 1 }, in: 'widgets' },
    },
    steps: [
      { id: 's1', action: 'click', target: 'WBP_Shop:Root/BtnBuy' },
      { id: 's2', action: 'click', target: { obj: 'nope', part: 'A/B' } },
      { id: 's3', action: 'invoke', object: '@sub.X', function: 'F' },
      { id: 's4', action: 'assert', cond: { target: 'WBP_X:.', visible: true } },
      { id: 's5', action: 'assert', expr: 'text("WBP_X:Root/T") == "a"' },
      { id: 's6', action: 'obj.wait', obj: { class: 'W', ident: [{ prop: ':checked', op: 'eq', value: 'Checked' }] } },
      { id: 's7', action: 'obj.wait', obj: { class: 'W' }, prop: ':count', op: 'between', value: 3 },
      { id: 's8', action: 'obj.wait', obj: { class: 'W' }, prop: ':nope' },
      { id: 's9', action: 'obj.wait', obj: { class: 'W' }, prop: ':text', op: 'bigger' },
      { id: 's10', action: 'wait', until: 'widgetGone', target: 'WBP_X:.' },
      { id: 's11', action: 'obj.set', obj: { class: 'W' }, prop: ':text', value: 'x' },
      { id: 's12', action: 'obj.close', obj: { class: 'W' }, how: [{ by: 'click' }, { by: 'explode' }] },
      { id: 's13', action: 'click', target: { obj: { class: '', many: 'some' } }, todo: '按第一个' },
    ],
  }
  const got = codes(bad)
  for (const want of [
    'migrate_todo@',
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
    'migrate_todo@steps.12',
  ])
    assert.ok(got.includes(want), `少了 ${want}：${got.join(' ')}`)
})

test('运行配置：旧字段报 settings_old，守护照场景查', () => {
  const r = validateSettingsRefs({
    itemKeys: [{ entry: 'WBP_Slot', by: ['ItemId'] }],
    guards: [
      { id: 'g1', when: { target: 'WBP_X:.', onScreen: true }, do: [{ action: 'widget.close', target: 'WBP_X:.' }] },
    ],
    identRules: [{ class: 'WBP_Slot' }],
  })
  assert.deepEqual(r.map((x) => x.code).sort(), [
    'action_removed',
    'bad_type',
    'cond_removed',
    'selector_removed',
    'settings_old',
  ])
})
