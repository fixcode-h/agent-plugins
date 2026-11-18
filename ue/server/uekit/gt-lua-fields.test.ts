// 代码变量弹窗的 Lua 组：---@field、self.xxx =、模块表字段，带行号，按赋值猜类型。
// 用法：node --test ue/server/uekit/gt-lua-fields.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLuaFields } from './gt-lua-fields.ts'

test('Lua 字段：注释优先，赋值补行号和类型', () => {
  const src = `---@class GuidePanel
---@field isLast boolean 到最后一页
local M = {}
M.MaxPage = 10
function M:Construct()
  -- 当前页（从 1 数）
  self.curPage = 1
  self.isLast = false
  self.cfg.guideId = 0 -- 配置表里的引导 Id
  if self.curPage == 1 then end
end
return M
`
  const items = parseLuaFields(src)
  assert.deepEqual(
    items.map((x) => `${x.path}:${x.type}:${x.line}`),
    ['self.isLast:boolean:2', 'M.MaxPage:number:4', 'self.curPage:number:7', 'self.cfg.guideId:number:9'],
  )
  assert.equal(items[0].note, '到最后一页')
  assert.equal(items[2].note, '当前页（从 1 数）')
  assert.equal(items[3].note, '配置表里的引导 Id')
})
