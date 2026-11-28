import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classIssues, fnRefsIn, luaFnIssues } from './check.ts'
import { injectLuaFns } from './inject.ts'
import { emptyLuaFnStore } from './schema.ts'

test('类结构拦下，注释和字符串里的不算', () => {
  assert.ok(classIssues('local M = {}\nM.__index = M\nreturn setmetatable({}, M)').length >= 2)
  assert.ok(classIssues('function Bag:Add(x) end').length)
  assert.deepEqual(classIssues('-- 不要 setmetatable\nlocal s = "class(x)"\nreturn require("Game.Bag").Count()'), [])
  assert.deepEqual(luaFnIssues({ name: '背包.加物品', params: ['itemId'], body: 'return 1' }), [])
  assert.ok(luaFnIssues({ name: '加物品', params: ['1a'], body: 'return 1' }).length === 2)
})

test('把用到的函数写进 lib：luafn 带自己的，lua 带 fn["…"] 用到的，没有的记 issue', () => {
  const store = { ...emptyLuaFnStore(), fns: [{ name: '背包.数量', params: ['id'], body: 'return 3' }] }
  const doc = {
    steps: [
      { id: 'a', action: 'luafn', fn: '背包.数量', args: { id: 1 } },
      { id: 'b', action: 'lua', code: 'return fn["背包.数量"](1) + 1' },
      { id: 'c', action: 'luafn', fn: '背包.没有' },
    ],
  }
  assert.deepEqual(fnRefsIn(doc.steps[1].code!), ['背包.数量'])
  const r = injectLuaFns(doc, store)
  const s = r.doc.steps as { lib?: unknown }[]
  assert.deepEqual(s[0].lib, { '背包.数量': { params: ['id'], body: 'return 3' } })
  assert.deepEqual(s[1].lib, { '背包.数量': { params: ['id'], body: 'return 3' } })
  assert.equal(r.issues.length, 1)
  assert.equal(injectLuaFns(r.doc, store).doc, r.doc)
})
