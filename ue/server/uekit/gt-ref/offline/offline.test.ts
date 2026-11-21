import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickClasses } from './classes.ts'
import { parseLuaHead } from './lua-parents.ts'
import { parseBpTags } from './uasset-tags.ts'

test('Lua 文件开头的继承写法', () => {
  assert.deepEqual(parseLuaHead('---@class ShopPanel : BasePanel\nlocal M = UnLua.Class("UI.Base.BasePanel")'), {
    cls: 'ShopPanel',
    parent: 'UI.Base.BasePanel',
  })
  assert.equal(parseLuaHead('local M = Class(require "UI/Base/BasePanel")').parent, 'UI.Base.BasePanel')
  assert.equal(parseLuaHead('local Base = require("UI.Base")\nlocal M = Class(Base)').parent, 'UI.Base')
  assert.equal(parseLuaHead('---@class Foo : Bar').parent, 'Bar')
  assert.deepEqual(parseLuaHead('local M = {}\nreturn M'), {})
})

test('.uasset 里的父类标签', () => {
  const pad = '\0'.repeat(40)
  const buf = Buffer.from(
    `WidgetBlueprintGeneratedClass${pad}NativeParentClass\0\x30\0\0\0/Script/CoreUObject.Class'/Script/UMG.UserWidget'\0` +
      `ParentClass\0\x40\0\0\0/Script/CoreUObject.Class'/Game/UI/W_Base.W_Base_C'\0`,
    'latin1',
  )
  assert.deepEqual(parseBpTags(buf), { parent: '/Game/UI/W_Base.W_Base_C', native: '/Script/UMG.UserWidget' })
  assert.equal(parseBpTags(Buffer.from('Texture2D ParentClass', 'latin1')), undefined)
})

test('离线类树：取一层、包含匹配带祖先', () => {
  const nodes = new Map(
    [
      { name: 'Object' },
      { name: 'UserWidget', parent: 'Object', kind: 'umg' as const },
      { name: 'W_Home', parent: 'UserWidget', kind: 'umg' as const, asset: '/Game/UI/W_Home.W_Home' },
      { name: 'W_Shop', parent: 'UserWidget', kind: 'umg' as const, asset: '/Game/UI/W_Shop.W_Shop' },
    ].map((n) => [n.name, n]),
  )
  const top = pickClasses(nodes, {}, 'Object')
  assert.deepEqual(
    top.items.map((x) => [x.name, x.kids]),
    [['UserWidget', 2]],
  )
  const found = pickClasses(nodes, { q: 'home' }, 'Object')
  assert.deepEqual(
    found.items.map((x) => x.name),
    ['Object', 'UserWidget', 'W_Home'],
  )
  assert.equal(found.hasMore, false)
})

test('离线 Lua 类：按目录列', () => {
  const nodes = new Map(
    ['/Module/A/X', '/Module/A/Sub/Y', '/Module/B/Z', 'Top'].map((name) => [name, { name, kind: 'lua' as const }]),
  )
  const root = pickClasses(nodes, { lua: true, dir: '' })
  assert.deepEqual(
    root.items.map((x) => x.name),
    ['Top'],
  )
  assert.deepEqual(root.dirs, [{ name: 'Module', count: 3 }])
  const a = pickClasses(nodes, { lua: true, dir: 'Module/A' })
  assert.deepEqual(
    a.items.map((x) => x.name),
    ['/Module/A/X'],
  )
  assert.deepEqual(a.dirs, [{ name: 'Module/A/Sub', count: 1 }])
})
