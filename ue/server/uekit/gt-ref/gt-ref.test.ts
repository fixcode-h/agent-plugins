// 面板侧的 GameTest 对象引用操作：gt.props 补 Lua 声明字段、版本门槛。
// 用法：node --test ue/server/uekit/gt-ref/gt-ref.test.ts
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../../../sdk/server.ts'
import type { GtPropItem } from '../../../shared/gt-script/ref/types.ts'
import { setCtx } from '../../util.ts'
import { gameTestTooOld, gtRefOp } from './ops.ts'
import { luaKind, mergeLuaProps } from './lua-props.ts'
import { gtProps, slimProps } from './tool.ts'

let proj = ''
before(async () => {
  proj = await mkdtemp(path.join(tmpdir(), 'gt-ref-'))
  await mkdir(path.join(proj, 'Content', 'Script', 'UI'), { recursive: true })
  setCtx({
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})
after(() => rm(proj, { recursive: true, force: true }))

test('Lua 类型 → kind（协议 7.5）', () => {
  assert.equal(luaKind('number'), 'float')
  assert.equal(luaKind('integer'), 'int')
  assert.equal(luaKind('string?'), 'string')
  assert.equal(luaKind('boolean|nil'), 'bool')
  assert.equal(luaKind('ItemData[]'), 'array')
  assert.equal(luaKind('table'), 'array')
  assert.equal(luaKind('UI.ShopPanel'), undefined)
})

test('Lua 声明合进 self 组：UE 给了的保留值，只有声明的带 note，没有 self 组时新建', () => {
  const decl = {
    file: 'UI/Shop.lua',
    fields: [
      { name: 'shopId', type: 'integer', kind: 'field' as const, line: 3, note: '商店编号' },
      { name: 'owner', type: 'Npc', kind: 'self' as const, line: 9 },
      { name: 'title', type: 'string', kind: 'field' as const, line: 4 },
    ],
  }
  const groups = [
    {
      id: 'self',
      title: 'Self',
      items: [
        {
          prop: '@#title',
          name: 'title',
          src: 'lua' as const,
          type: 'any',
          kind: 'string' as const,
          value: '杂货铺',
        },
      ],
    },
  ]
  const r = mergeLuaProps(groups, decl, { selfTitle: '自己' })
  const items = r.groups[0].items
  assert.equal(r.added, 2)
  assert.equal(items[0].value, '杂货铺')
  assert.equal(items[0].type, 'string')
  assert.equal(groups[0].items[0].type, 'any')
  const id = items.find((x) => x.name === 'shopId')!
  assert.equal(id.prop, '@#shopId')
  assert.equal(id.kind, 'int')
  assert.ok(id.ops?.includes('eq'))
  assert.match(id.note ?? '', /商店编号/)
  assert.match(id.declAt ?? '', /UI\/Shop\.lua:3/)
  // 类型要运行时才知道的 self 变量也能加进判断（用户 2026-11-22），按文字比
  const owner = items.find((x) => x.name === 'owner')!
  assert.notEqual(owner.comparable, false)
  assert.equal(owner.kind, 'string')
  assert.equal(mergeLuaProps([], decl, { selfTitle: '自己', filter: 'shop' }).groups[0].items.length, 1)
})

test('版本门槛：GameTest 低于 2.0.0 或没加载时报升级；名片没列扩展时交给 UE', () => {
  assert.match(gameTestTooOld({ extensions: [{ name: 'GameTest', version: '1.12.0' }] }) ?? '', /2\.0\.0/)
  assert.ok(gameTestTooOld({ extensions: [{ name: 'AssetForge', version: '1.0.0' }] }))
  assert.equal(gameTestTooOld({ extensions: [{ name: 'GameTest', version: '2.0.0' }] }), undefined)
  assert.equal(gameTestTooOld({}), undefined)
  // gt.classes 要 2.1.0：2.0.0 的 GameTest 不够
  assert.match(gameTestTooOld({ extensions: [{ name: 'GameTest', version: '2.0.0' }] }, '2.1.0') ?? '', /2\.1\.0/)
})

test('gt.props：UE 太旧时只要知道 luaModule 照样返回 Lua 声明字段；别的操作直接报升级', async () => {
  await writeFile(
    path.join(proj, 'Content', 'Script', 'UI', 'Shop.lua'),
    '---@class ShopPanel\n---@field shopId integer 商店编号\nlocal M = {}\nreturn M\n',
  )
  const old = { extensions: [{ name: 'GameTest', version: '1.12.0' }] }
  const deps = {
    project: { root: proj },
    pick: async () => old,
    send: async () => ({}),
  }
  const r = await gtRefOp('gt.props', { class: 'WBP_Shop', luaModule: 'UI.Shop' }, deps)
  assert.match(String(r.unavailable), /2\.0\.0/)
  assert.equal(r.luaFile, 'UI/Shop.lua')
  const g = (r.groups as { id: string; items: { prop: string }[] }[])[0]
  assert.equal(g.id, 'self')
  assert.deepEqual(
    g.items.map((x) => x.prop),
    ['@#shopId'],
  )
  await assert.rejects(gtRefOp('gt.tree', {}, deps), /2\.0\.0/)
  await assert.rejects(gtRefOp('gt.props', { class: 'WBP_Shop' }, deps), /2\.0\.0/)
  // UE 回「不认识的操作」也换成升级提示；luaModule 不转给 UE
  let sent: Record<string, unknown> = {}
  const fresh = {
    project: { root: proj },
    pick: async () => ({}),
    send: async (_c: unknown, a: Record<string, unknown>) => {
      sent = a
      if (a.node) throw new Error('unknown op gt.refFor')
      return { class: 'WBP_Shop_C', luaModule: 'UI.Shop', groups: [] }
    },
  }
  await assert.rejects(gtRefOp('gt.refFor', { node: 'n1' }, fresh), /请升级 GameTest/)
  const ok = await gtRefOp('gt.props', { class: 'WBP_Shop', luaModule: 'X' }, fresh)
  assert.equal(sent.luaModule, undefined)
  assert.equal(ok.unavailable, undefined)
  assert.equal((ok.groups as { items: unknown[] }[])[0].items.length, 1)
})

test('ue_gametest props：参数整理，逐项的 ops 收成 opsByKind', async () => {
  const slim = slimProps({
    groups: [
      {
        id: 'self',
        title: '',
        items: [{ prop: '@.Id', name: 'Id', src: 'cpp', type: 'int32', kind: 'int', ops: ['eq'] }],
      },
    ],
  })
  const g = (slim.groups as { items: Record<string, unknown>[] }[])[0]
  assert.equal(g.items[0].ops, undefined)
  assert.ok((slim.opsByKind as Record<string, string[]>).int.includes('between'))
  const calls: [string, Record<string, unknown>][] = []
  const op = async (name: string, args: Record<string, unknown> = {}) => {
    calls.push([name, args])
    return { groups: [] }
  }
  assert.ok((await gtProps(op, {})).error)
  await gtProps(op, { object: 'shop', module: 'UI.Shop', limit: 999 })
  assert.deepEqual(calls[0], ['gt.props', { target: { obj: 'shop' }, luaModule: 'UI.Shop', offset: 0, limit: 400 }])
})

test('游戏没开：Lua 类的函数从源码读，顺着父类继承', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const root = await mkdtemp(path.join(tmpdir(), 'lua-decl-'))
  try {
    await mkdir(path.join(root, 'UI'), { recursive: true })
    await writeFile(
      path.join(root, 'UI/Base.lua'),
      'local M = {}\nfunction M:Open(a, b) end\nfunction M:Close() end\nreturn M\n',
    )
    await writeFile(
      path.join(root, 'UI/Shop.lua'),
      '---@class Shop\nlocal M = Class("UI.Base")\n---@field shopId integer\nfunction M:Open(id) end\nfunction M:Buy(item, n) end\nreturn M\n',
    )
    await writeFile(
      path.join(root, 'UI/Child.lua'),
      '---@class Child : Base\nlocal Base = require "UI.Base"\nlocal M = setmetatable({}, Base)\nfunction M:Own() end\nreturn M\n',
    )
    const { luaDeclared } = await import('./lua-props.ts')
    const child = await luaDeclared(root, 'UI.Child')
    assert.deepEqual(
      child?.functions.map((f) => f.name),
      ['Own', 'Open', 'Close'],
    )
    const d = await luaDeclared(root, '/UI/Shop')
    assert.ok(d)
    assert.deepEqual(
      d.functions.map((f) => [f.name, f.params.join(','), f.from ?? '']),
      [
        ['Open', 'id', ''],
        ['Buy', 'item,n', ''],
        ['Close', '', 'UI.Base'],
      ],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('没开游戏时 Lua 字段的值取源码里的初始赋值（用户 2026-11-21：值是空的）', async () => {
  const { parseLuaModule } = await import('../gt-author/lua-parse.ts')
  const info = parseLuaModule(
    [
      'local M = Class()',
      '---@field Count number 数量',
      'M.Mode = "normal"',
      'function M:Ctor()',
      '  self.Count = 3',
      '  self.Enabled = true',
      '  self.Items = {}',
      '  self.Owner = GetOwner()',
      'end',
      'return M',
    ].join('\n'),
  )
  const byName = Object.fromEntries(info.fields.map((f) => [f.name, f]))
  assert.equal(byName.Count.init, '3')
  assert.equal(byName.Mode.init, '"normal"')
  const r = mergeLuaProps([], { file: 'M.lua', fields: info.fields }, { selfTitle: '自己' })
  const v = Object.fromEntries(r.groups[0].items.map((x) => [x.name, x]))
  assert.equal(v.Count.value, 3)
  assert.equal(v.Mode.value, 'normal')
  assert.equal(v.Enabled.value, true)
  assert.equal(v.Owner.value, undefined)
  assert.equal(v.Owner.srcInit, 'GetOwner()')
})

test('注解里带空格的类型不切断（table<number, Foo>|nil）', async () => {
  const { splitType } = await import('../gt-author/lua-parse.ts')
  assert.deepEqual(splitType('table<number, Foo>|nil 当前索引'), { type: 'table<number, Foo>|nil', note: '当前索引' })
  assert.deepEqual(splitType('number | string 名字'), { type: 'number | string', note: '名字' })
  assert.deepEqual(splitType('boolean'), { type: 'boolean', note: '' })
})

test('gt.props：游戏开着、选了实例时按实例表补 UE 没给的 Lua 字段此刻的值，nil 的说清原因', async () => {
  await mkdir(path.join(proj, 'Content', 'Script', 'Player'), { recursive: true })
  await writeFile(
    path.join(proj, 'Content', 'Script', 'Player', 'Hero.lua'),
    'local M = {}\nfunction M:ReceiveBeginPlay()\n  self.DefaultFOV = self.Camera.FieldOfView\n  self.Later = nil\nend\nreturn M\n',
  )
  let asked: unknown
  const deps = {
    project: { root: proj },
    pick: async () => ({}),
    send: async () => ({ class: 'BP_Hero_C', luaModule: 'Player.Hero', groups: [] }),
    luaFields: async (_c: unknown, p: string) => {
      asked = p
      return {
        value: { t: 'table' },
        fields: [
          { k: 'DefaultFOV', kt: 'string', t: 'number', v: 90 },
          { k: 'Bag', kt: 'string', t: 'table', v: 'table: 0x1' },
          { k: 'Tick', kt: 'string', t: 'function' },
          { k: 'Mode', kt: 'string', t: 'string', v: 'run' },
        ],
      }
    },
  }
  const r = await gtRefOp('gt.props', { path: '/Game/Map.Map:Hero_1' }, deps)
  assert.equal(asked, '/Game/Map.Map:Hero_1')
  const items = (r.groups as { id: string; items: GtPropItem[] }[]).find((g) => g.id === 'self')!.items
  const fov = items.find((x) => x.name === 'DefaultFOV')!
  assert.equal(fov.value, 90)
  assert.equal(fov.kind, 'float')
  assert.equal(fov.fromSource, undefined)
  assert.match(fov.declAt ?? '', /Player\/Hero\.lua:3/)
  const later = items.find((x) => x.name === 'Later')!
  assert.equal(later.fromSource, true)
  assert.match(later.srcWhy ?? '', /nil/)
  // 源码里没认出来的也列出来；函数不算字段，表不能直接比
  assert.equal(items.find((x) => x.name === 'Mode')?.value, 'run')
  assert.equal(
    items.find((x) => x.name === 'Tick'),
    undefined,
  )
  assert.equal(items.find((x) => x.name === 'Bag')?.value, undefined)
  // 只按类读（没选实例）：说没选实例，不说游戏没开
  const cls = await gtRefOp('gt.props', { class: 'BP_Hero_C' }, deps)
  const one = (cls.groups as { id: string; items: GtPropItem[] }[])[0].items.find((x) => x.name === 'DefaultFOV')!
  assert.match(one.srcWhy ?? '', /没选实例/)
})

test('gt.classes lua：类树按磁盘源码列，UE 只补此刻实例数；磁盘读不到时用 UE 的', async () => {
  const ue = {
    items: [
      { name: 'BP_Game_C', kind: 'lua', kids: 0, live: 1 },
      { name: 'UnLua', kind: 'lua', kids: 0, live: 0 },
    ],
    dirs: [{ name: 'UnLua', count: 2 }],
    total: 2,
    hasMore: false,
  }
  const disk = {
    items: [
      { name: 'BP_CharacterBase_C', kind: 'lua', kids: 0 },
      { name: 'BP_Game_C', kind: 'lua', kids: 0 },
    ],
    dirs: [{ name: 'Tests', count: 3 }],
    total: 2,
    hasMore: false,
    note: '',
  }
  const deps = (d: typeof disk | undefined) => ({
    project: { root: proj },
    pick: async () => ({}),
    send: async () => ue,
    offlineClasses: async () => {
      if (!d) throw new Error('no index')
      return d
    },
  })
  const r = await gtRefOp('gt.classes', { lua: true, dir: '' }, deps(disk))
  assert.deepEqual(
    (r.items as { name: string; live?: number }[]).map((x) => [x.name, x.live]),
    [
      ['BP_CharacterBase_C', undefined],
      ['BP_Game_C', 1],
    ],
  )
  assert.deepEqual(r.dirs, [{ name: 'Tests', count: 3 }])
  assert.equal(r.note, undefined)
  assert.equal((await gtRefOp('gt.classes', { lua: true, dir: '' }, deps(undefined))).total, 2)
  // UE 类树（不是 lua）照旧用 UE 的
  assert.equal((await gtRefOp('gt.classes', {}, deps(disk))).dirs, ue.dirs)
})
