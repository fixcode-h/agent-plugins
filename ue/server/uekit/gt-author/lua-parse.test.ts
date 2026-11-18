// Lua 模块源码扫描（lua-parse.ts）：字段、函数、EmmyLua 注释、长注释跳过、模块表认法。
// 用法：node --test ue/server/uekit/gt-author/lua-parse.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLuaModule } from './lua-parse.ts'

const GUIDE = `
---@class GuidePanel
---@field curStep integer 当前第几页
---@field private secret string
local GuidePanel = UnLua.Class()

--[[
function GuidePanel:Fake() self.fake = 1 end
]]

-- 打开时初始化
function GuidePanel:Construct()
    self.curStep = 1
    self.isLast = false -- 翻到最后一页
    self.title = "引导"
    if self.isLast == true then end
end

---翻到下一页
---@param n integer 翻几页
---@return boolean 翻完了没有
function GuidePanel:Next(n)
    self.pages = {}
end

return GuidePanel
`

test('UI 模块：---@field、self 字段、方法和注释', () => {
  const m = parseLuaModule(GUIDE)
  assert.equal(m.table, 'GuidePanel')
  const names = m.fields.map((f) => `${f.kind}:${f.name}:${f.type}`)
  assert.deepEqual(names, [
    'field:curStep:integer',
    'field:secret:string',
    'self:isLast:boolean',
    'self:title:string',
    'self:pages:table',
  ])
  assert.equal(m.fields[0].note, '当前第几页')
  assert.ok(!m.fields.some((f) => f.name === 'fake'), '长注释里的不算')
  const next = m.functions.find((f) => f.name === 'Next')!
  assert.equal(next.method, true)
  assert.deepEqual(next.args, [{ name: 'n', type: 'integer', note: '翻几页' }])
  assert.equal(next.returns, 'boolean')
  assert.equal(next.note, '翻到下一页')
  assert.equal(m.functions.find((f) => f.name === 'Construct')!.note, '打开时初始化')
})

test('普通模块：表构造的键、M.x 字段、M.Fn = function、---@readonly', () => {
  const m = parseLuaModule(`local M = {
  maxLevel = 60,
  name = "q",
  sub = { a = 1 },
}
M.count = 0

---@readonly
---@param id integer
---@return boolean
function M.IsDone(id) return true end

M.Reset = function(a, b) end

local function helper() end
return M`)
  assert.deepEqual(
    m.fields.map((f) => `${f.name}:${f.type}`),
    ['maxLevel:number', 'name:string', 'sub:table', 'count:number'],
  )
  assert.deepEqual(
    m.functions.map((f) => `${f.name}:${f.readOnly}:${f.args.map((a) => a.type).join('|')}`),
    ['IsDone:true:integer', 'Reset:false:any|any'],
  )
})

test('没有 return 时按 function X. 出现最多的名字认模块表', () => {
  const m = parseLuaModule(`Q = Q or {}\nfunction Q.A() end\nfunction Q.B() end\n`)
  assert.equal(m.table, 'Q')
  assert.equal(m.functions.length, 2)
})
