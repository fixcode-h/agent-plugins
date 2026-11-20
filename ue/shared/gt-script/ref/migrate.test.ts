// v1–v3 → v4 迁移（协议 game-test-ref 第 9 节）：迁移表的每一行至少一个用例，迁不准的写 todo + many: "first"，
// 迁完的场景要能过 v4 校验（只剩 migrate_todo 警告）。
// 用法：node --test ue/shared/gt-script/ref/migrate.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GtScript, GtStep } from '../types.ts'
import { migrateExpr, migrateScript, migrateSettings, newCtx, selectorToTarget } from './migrate/index.ts'
import { validateRefs } from './validate.ts'

const sel = (s: string, hint?: Record<string, unknown>) => {
  const ctx = newCtx()
  ctx.hint = hint
  return { t: selectorToTarget(s, ctx), todos: ctx.pending }
}

/** 迁一份只有这几步的场景，返回迁完的步骤和待定 */
function steps(list: GtStep[], extra: Partial<GtScript> = {}) {
  const r = migrateScript({ schemaVersion: 3, ...extra, steps: list })
  const errors = validateRefs(r.doc).filter((x) => x.level === 'error')
  assert.deepEqual(errors, [], '迁完要能过 v4 校验')
  return { steps: r.doc.steps!, doc: r.doc, todos: r.todos }
}

test('屏名:路径 → 对象 + 最后一段当部件；屏名:. → 对象本身', () => {
  assert.deepEqual(sel('WBP_Shop:Root/Header/BtnBuy').t, { obj: { class: 'WBP_Shop' }, part: 'BtnBuy' })
  assert.deepEqual(sel('WBP_Shop:.').t, { obj: { class: 'WBP_Shop' } })
  assert.deepEqual(sel('/Game/UI/WBP_Shop:Root/BtnBuy').t, { obj: { class: '/Game/UI/WBP_Shop' }, part: 'BtnBuy' })
})

test('A>B → part "A.B"（嵌套 WBP）', () => {
  assert.deepEqual(sel('WBP_Shop:Root/Header>Root/BtnClose').t, { obj: { class: 'WBP_Shop' }, part: 'Header.BtnClose' })
  assert.deepEqual(sel('WBP_Shop:Root/Header>Inner>BtnClose').t, {
    obj: { class: 'WBP_Shop' },
    part: 'Header.Inner.BtnClose',
  })
})

test('容器[字段=值]>B → 条目引用 + 部件', () => {
  const list = sel('WBP_Bag:Root/ItemList[ItemId=1001]>BtnUse', { key: { list: true, entry: 'WBP_BagSlot' } })
  assert.deepEqual(list.t, {
    obj: {
      class: 'WBP_BagSlot',
      in: { obj: { class: 'WBP_Bag' }, part: 'ItemList' },
      ident: [{ prop: '@item.ItemId', op: 'eq', value: 1001 }],
    },
    part: 'BtnUse',
  })
  assert.deepEqual(list.todos, [])
  // 不是 ListView 的容器看条目控件自己；写了来源的照抄；两个条件都要
  const grid = sel('WBP_Bag:Grid[Slot=3,@lua.kind="gem"]>Icon', { key: { list: false, entry: 'WBP_Cell' } })
  assert.deepEqual((grid.t!.obj as { ident: unknown }).ident, [
    { prop: '@self.Slot', op: 'eq', value: 3 },
    { prop: '@lua.kind', op: 'eq', value: 'gem' },
  ])
  // 不知道条目类、不知道是不是列表：写 UserWidget、按 @item. 迁，都写 todo
  const bare = sel('WBP_Bag:ItemList[ItemId=$id]')
  assert.deepEqual(bare.t, {
    obj: {
      class: 'UserWidget',
      in: { obj: { class: 'WBP_Bag' }, part: 'ItemList' },
      ident: [{ prop: '@item.ItemId', op: 'eq', value: '$id' }],
    },
  })
  assert.equal(bare.todos.length, 2)
})

test('@句柄 → $句柄（find → obj.find saveAs），句柄落在部件上时后面接着拼', () => {
  const r = steps([
    { action: 'find', target: 'WBP_Shop:Root/Header', into: 'hdr' },
    { action: 'click', target: '@hdr>BtnClose' },
    { action: 'find', target: 'WBP_Bag:.' },
    { action: 'click', target: '@WBP_Bag' },
  ])
  assert.deepEqual(r.steps[0], { action: 'obj.find', obj: { class: 'WBP_Shop' }, saveAs: 'hdr' })
  assert.deepEqual(r.steps[1].target, { obj: '$hdr', part: 'Header.BtnClose' })
  assert.equal(r.steps[2].saveAs, 'WBP_Bag')
  assert.deepEqual(r.steps[3].target, { obj: '$WBP_Bag' })
})

test('列表[n]、#类名#n、text=…、没写屏名、>>Slate 前没有 UMG：从录制线索挑标识，挑不出 many first + todo', () => {
  const byHint = sel('WBP_Bag:ItemList[2]>BtnUse', {
    key: {
      list: true,
      entry: 'WBP_BagSlot',
      cands: [
        { by: 'Data.ItemId', v: 7, unique: true, score: 9 },
        { by: 'Name', v: 'x', unique: false, score: 10 },
      ],
    },
  })
  assert.deepEqual((byHint.t!.obj as { ident: unknown }).ident, [{ prop: '@item.Data.ItemId', op: 'eq', value: 7 }])
  assert.deepEqual(byHint.todos, [])
  const noHint = sel('WBP_Bag:ItemList[2]>BtnUse', { key: { entry: 'WBP_BagSlot' } })
  assert.equal((noHint.t!.obj as { many: string }).many, 'first')
  assert.equal(noHint.todos.length, 1)
  const byClass = sel('WBP_Main:Root/Box/#WBP_Entry#2>Btn')
  assert.deepEqual(byClass.t, {
    obj: { class: 'WBP_Entry', in: { obj: { class: 'WBP_Main' }, part: 'Box' }, many: 'first' },
    part: 'Btn',
  })
  const byText = sel('WBP_Main:Root/text=确定')
  assert.deepEqual(byText.t, { obj: { class: 'WBP_Main' } })
  assert.equal(byText.todos.length, 1)
  const noScreen = sel('Root/BtnStart', { asset: '/Game/UI/WBP_Menu.WBP_Menu' })
  assert.deepEqual(noScreen.t, { obj: { class: '/Game/UI/WBP_Menu', many: 'first' }, part: 'BtnStart' })
  const slateOnly = sel('>>SMenuEntry[text=复制]')
  assert.deepEqual(slateOnly.t, { obj: { class: 'UserWidget', many: 'first' }, slate: 'SMenuEntry[text=复制]' })
  assert.equal(slateOnly.todos.length, 1)
})

test('>>Slate段 → slate', () => {
  assert.deepEqual(sel('WBP_Set:Root/Quality>>STableRow[text=高]').t, {
    obj: { class: 'WBP_Set' },
    part: 'Quality',
    slate: 'STableRow[text=高]',
  })
})

test('objects 定位器 → 引用：key → ident，many 按 near / key 定，component 另起组件引用', () => {
  const r = steps([{ action: 'mark', text: 'x' }], {
    objects: {
      npc: { class: 'BP_ShopNpc_C', key: { NpcId: 1001, '@lua.kind': 'shop' }, client: 0 },
      any: { class: 'BP_Chest', in: 'world' },
      near: { class: 'BP_Monster', near: '@pawn' },
      ui: { class: 'WBP_Bag', in: 'widgets', key: { Owner: '$me' } },
      hp: { class: 'BP_Hero', key: { HeroId: 1 }, component: 'HealthComponent' },
    },
    vars: { me: 1 },
  })
  const o = r.doc.objects as Record<string, unknown>
  assert.deepEqual(o.npc, {
    class: 'BP_ShopNpc_C',
    ident: [
      { prop: '@self.NpcId', op: 'eq', value: 1001 },
      { prop: '@lua.kind', op: 'eq', value: 'shop' },
    ],
    client: 0,
  })
  assert.deepEqual(o.any, { class: 'BP_Chest', in: 'world', many: 'first' })
  assert.deepEqual(o.near, { class: 'BP_Monster', near: '@pawn', many: 'nearest' })
  assert.deepEqual(o.ui, { class: 'WBP_Bag', in: 'screen', ident: [{ prop: '@self.Owner', op: 'eq', value: '$me' }] })
  assert.deepEqual(o.hpOwner, { class: 'BP_Hero', ident: [{ prop: '@self.HeroId', op: 'eq', value: 1 }] })
  assert.equal((o.hp as { class: string }).class, 'HealthComponent')
  assert.deepEqual((o.hp as { in: unknown }).in, { obj: 'hpOwner' })
  assert.ok(r.todos.some((x) => x.at === 'objects.hp'))
})

test('条件：target + visible / exists / enabled / checked / selected / onScreen → 状态 + is', () => {
  const r = steps([
    {
      action: 'if',
      cond: {
        all: [
          { target: 'WBP_X:Root/A', visible: true },
          { target: 'WBP_X:.', exists: false },
          { target: 'WBP_X:Root/B', enabled: true },
          { target: 'WBP_X:Root/C', checked: true },
          { not: { target: 'WBP_X:Root/D', selected: true } },
          { target: 'WBP_X:.', onScreen: true },
        ],
        settleMs: 500,
      },
      then: [],
    },
  ])
  const x = { class: 'WBP_X' }
  assert.deepEqual(r.steps[0].cond, {
    all: [
      { obj: x, prop: '@A:shown', op: 'is', value: true },
      { obj: x, prop: ':exists', op: 'is', value: false },
      { obj: x, prop: '@B:enabled', op: 'is', value: true },
      { obj: x, prop: '@C:checked', op: 'is', value: 'Checked' },
      { not: { obj: x, prop: '@D:selected', op: 'is', value: true } },
      { obj: x, prop: ':onScreen', op: 'is', value: true },
    ],
    settleMs: 500,
  })
})

test('text / textContains / textLike / textMatches → :text + eq / contains / contains + todo / matches', () => {
  const r = steps([
    { action: 'assert', cond: { target: 'W:T', text: 'a' } },
    { action: 'assert', cond: { target: 'W:T', textContains: 'b' } },
    { action: 'assert', cond: { target: 'W:T', textLike: '已领取' } },
    { action: 'assert', cond: { target: 'W:T', textMatches: '^\\d+$' } },
  ])
  assert.deepEqual(
    r.steps.map((s) => [(s.cond as { op: string }).op, (s.cond as { prop: string }).prop]),
    [
      ['eq', '@T:text'],
      ['contains', '@T:text'],
      ['contains', '@T:text'],
      ['matches', '@T:text'],
    ],
  )
  assert.ok(typeof r.steps[2].todo === 'string')
  assert.equal(r.steps[0].todo, undefined)
})

test('number: {gt: 3} → num(prop(引用, ":text")) 表达式；count / image / field', () => {
  const r = steps([
    { action: 'assert', cond: { target: 'W:Root/Gold', number: { gt: 3 } } },
    { action: 'assert', cond: { target: 'W:Root/Gold', number: { between: [1, 5] } } },
    { action: 'assert', cond: { target: 'W:Root/List', count: 3 } },
    { action: 'assert', cond: { target: 'W:Root/Tick', image: 'T_Check' } },
    { action: 'assert', cond: { target: 'W:Root/Btn', field: '@self.bClaimed', equals: true } },
    { action: 'assert', cond: { target: 'W:.', field: '@lua.isLast' } },
  ])
  assert.deepEqual(r.steps[0].cond, { expr: 'num(prop({"class":"W"}, "@Gold:text")) > 3' })
  assert.deepEqual(r.steps[1].cond, {
    expr: 'num(prop({"class":"W"}, "@Gold:text")) >= 1 and num(prop({"class":"W"}, "@Gold:text")) <= 5',
  })
  assert.deepEqual(r.steps[2].cond, { obj: { class: 'W' }, prop: '@List:count', op: 'eq', value: 3 })
  assert.deepEqual(r.steps[3].cond, { obj: { class: 'W' }, prop: '@Tick:image', op: 'contains', value: 'T_Check' })
  assert.deepEqual(r.steps[4].cond, { obj: { class: 'W' }, prop: '@self.bClaimed', op: 'eq', value: true })
  assert.deepEqual(r.steps[5].cond, { obj: { class: 'W' }, prop: '@lua.isLast' })
})

test('1.x 写在步骤上的 assert 判断、skipIf 省略 target 用这一步自己的', () => {
  const r = steps([
    { action: 'assert', target: 'W:Root/Title', textContains: '商店', visible: true },
    { action: 'click', target: 'W:Root/Claim', skipIf: { textLike: '已领取', also: 1 } },
  ])
  assert.deepEqual(r.steps[0], {
    action: 'assert',
    cond: {
      all: [
        { obj: { class: 'W' }, prop: '@Title:shown', op: 'is', value: true },
        { obj: { class: 'W' }, prop: '@Title:text', op: 'contains', value: '商店' },
      ],
    },
  })
  assert.deepEqual(r.steps[1].skipIf, {
    obj: { class: 'W' },
    prop: '@Claim:text',
    op: 'contains',
    value: '已领取',
    also: 1,
  })
  assert.deepEqual(r.steps[1].target, { obj: { class: 'W' }, part: 'Claim' })
})

test('widget.close → obj.close how remove，widget.call → obj.call（不一定是关界面）', () => {
  const r = steps([
    { action: 'widget.close', target: 'WBP_Notice:.' },
    { action: 'widget.call', target: 'WBP_Notice:.', function: 'CloseSelf' },
  ])
  assert.deepEqual(r.steps[0], { action: 'obj.close', obj: { class: 'WBP_Notice' }, how: [{ by: 'remove' }] })
  assert.deepEqual(r.steps[1], { action: 'obj.call', obj: { class: 'WBP_Notice' }, function: 'CloseSelf' })
})

test('invoke → obj.call（object 改 obj），find → obj.find', () => {
  const r = steps(
    [
      {
        action: 'invoke',
        object: '@sub.UQuestSubsystem',
        function: 'Accept',
        args: { Id: 1 },
        saveAs: 'ok',
        expect: { equals: true },
      },
      { action: 'invoke', object: { $obj: 'npc' }, function: 'Open' },
      { action: 'invoke', object: { target: 'WBP_Bag:Root/List' }, function: 'Refresh' },
      { action: 'invoke', function: 'UMyLib.Reset' },
      { action: 'find', target: 'WBP_Bag:.', into: '@bag' },
    ],
    { objects: { npc: { class: 'BP_Npc', key: { Id: 1 } } } },
  )
  assert.deepEqual(r.steps[0], {
    action: 'obj.call',
    obj: '@sub.UQuestSubsystem',
    function: 'Accept',
    args: { Id: 1 },
    saveAs: 'ok',
    expect: { equals: true },
  })
  assert.equal(r.steps[1].obj, 'npc')
  assert.deepEqual([r.steps[2].obj, r.steps[2].part], [{ class: 'WBP_Bag' }, 'List'])
  assert.deepEqual(r.steps[3], { action: 'obj.call', function: 'UMyLib.Reset' })
  assert.deepEqual(r.steps[4], { action: 'obj.find', obj: { class: 'WBP_Bag' }, saveAs: 'bag' })
})

test('wait until=widget / widgetGone → wait until=cond + :exists', () => {
  const r = steps([
    { action: 'wait', until: 'widget', target: 'WBP_X:Root/Btn' },
    { action: 'wait', until: 'widgetGone', target: 'WBP_X:.' },
    { action: 'wait', until: 'seconds', seconds: 1 },
  ])
  assert.deepEqual(r.steps[0], {
    action: 'wait',
    until: 'cond',
    cond: { obj: { class: 'WBP_X' }, prop: '@Btn:exists', op: 'is', value: true },
  })
  assert.deepEqual(r.steps[1], {
    action: 'wait',
    until: 'cond',
    cond: { obj: { class: 'WBP_X' }, prop: ':exists', op: 'is', value: false },
  })
  assert.deepEqual(r.steps[2], { action: 'wait', until: 'seconds', seconds: 1 })
})

test('表达式 text(sel) 等 → prop(引用, ":text")；参数不是字面量的写 todo', () => {
  const ctx = newCtx()
  assert.equal(
    migrateExpr(
      `text("W:Root/T") == 'text("x")' and number('W:Root/N') > 2 and checked("W:Root/C") and count("W:L")`,
      ctx,
    ),
    `prop({"class":"W"}, "@T:text") == 'text("x")' and num(prop({"class":"W"}, "@N:text")) > 2 and (prop({"class":"W"}, "@C:checked") == "Checked") and prop({"class":"W"}, "@L:count")`,
  )
  assert.deepEqual(ctx.pending, [])
  assert.equal(migrateExpr('visible($sel) and @ps.Gold > 3', ctx), 'visible($sel) and @ps.Gold > 3')
  assert.equal(ctx.pending.length, 1)
  // 填值处的 "=…" 和条件里的 expr 都改；字符串里的同名函数不动
  const r = steps([
    { action: 'set', var: 'n', value: '=exists("W:.")' },
    { action: 'assert', cond: { expr: 'enabled("W:Root/B")' } },
  ])
  assert.equal(r.steps[0].value, '=prop({"class":"W"}, ":exists")')
  assert.deepEqual(r.steps[1].cond, { expr: 'prop({"class":"W"}, "@B:enabled")' })
})

test('vars 里存选择器的变量：用到的地方换成部件写法，没人用了从 vars 里拿掉', () => {
  const r = steps(
    [
      { action: 'click', target: '$btn' },
      { action: 'assert', expr: 'text($title) == "x"' },
    ],
    { vars: { btn: 'W:Root/Btn', title: 'W:Root/Title', n: 0 } },
  )
  assert.deepEqual(r.steps[0].target, { obj: { class: 'W' }, part: 'Btn' })
  assert.equal(r.steps[1].expr, 'prop({"class":"W"}, "@Title:text") == "x"')
  assert.deepEqual(r.doc.vars, { n: 0 })
})

test('守护的 when 和 do 一起迁；v1 的 click 补 via:code；迁完是 v4', () => {
  const r = migrateScript({
    steps: [{ action: 'click', target: 'W:Root/A' }],
    guards: [
      {
        id: 'g1',
        when: { target: 'WBP_Guide:.', onScreen: true },
        do: [{ action: 'widget.close', target: 'WBP_Guide:.' }],
      },
    ],
  })
  assert.equal(r.doc.schemaVersion, 4)
  assert.equal(r.doc.steps![0].via, 'code')
  assert.deepEqual(r.doc.guards![0].when, { obj: { class: 'WBP_Guide' }, prop: ':onScreen', op: 'is', value: true })
  assert.equal(r.doc.guards![0].do![0].action, 'obj.close')
  assert.equal(migrateScript(r.doc).changed, false, '已经是 v4 的不动')
})

test('_settings.json：itemKeys / objectKeys → identRules，blockers → guards，守护照场景迁', () => {
  const r = migrateSettings({
    stepDelayMs: 0,
    itemKeys: [
      { entry: 'WBP_BagSlot', container: 'WBP_Bag:Root/ItemList', by: ['Data.ItemId'] },
      { entry: 'WBP_Cell', by: ['@self.Slot'] },
    ],
    objectKeys: [{ class: 'BP_Npc', by: ['NpcId', '@lua.id'] }],
    blockers: [{ widget: 'WBP_Notice', action: 'call', function: 'Close', delayMs: 300, name: '公告' }],
    guards: [
      {
        id: 'g1',
        when: { target: 'WBP_Guide:.', onScreen: true },
        do: [{ action: 'widget.close', target: 'WBP_Guide:.' }],
      },
    ],
  })
  assert.equal(r.changed, true)
  assert.deepEqual(r.doc.identRules, [
    {
      class: 'WBP_BagSlot',
      ident: ['@item.Data.ItemId'],
      in: { obj: { class: 'WBP_Bag' }, part: 'ItemList' },
      note: '从 itemKeys 迁移：Data.ItemId 按条目的数据对象（@item.）认，容器不是 ListView 时改成 @self.',
    },
    { class: 'WBP_Cell', ident: ['@self.Slot'] },
    { class: 'BP_Npc', ident: ['@self.NpcId', '@lua.id'] },
  ])
  assert.ok(!('itemKeys' in r.doc) && !('objectKeys' in r.doc) && !('blockers' in r.doc))
  assert.equal(r.doc.stepDelayMs, 0)
  const guards = r.doc.guards as { id: string; when: unknown; do: GtStep[] }[]
  assert.deepEqual(
    guards.map((g) => [g.id, g.do[0].action]),
    [
      ['g1', 'obj.close'],
      ['b1', 'obj.close'],
    ],
  )
  assert.deepEqual(guards[1].when, {
    obj: { class: 'WBP_Notice' },
    prop: ':onScreen',
    op: 'is',
    value: true,
    settleMs: 300,
  })
  assert.equal(migrateSettings(r.doc).changed, false, '迁过的再迁不变')
})
