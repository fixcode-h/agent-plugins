// GameTest 项目接口的 Lua 部分：按 EmmyLua 注释认参数、返回、只读；只认模块表上的函数；私有和变参的列进没认出来的。
// 用法：node --test ue/server/uekit/gt-api-lua.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLuaApi } from './gt-api-lua.ts'

const SRC = `local M = {}

local function helper() end

--- 完成任务（直接改存档里的任务状态）
---@category 任务
---@param questId integer 任务 Id
---@param force? boolean 已完成也再走一遍
---@return boolean 成功没有
function M.Finish(questId, force)
end

--- 当前金币
---@readonly
---@return integer
M.Gold = function()
end

function M:Reset(slot) end

function M._Private() end
function M.Log(...) end

return M
`

test('Lua 接口：参数、返回、只读、分类、说明', () => {
  const r = parseLuaApi(SRC, 'GameTestApi.QuestApi', 'Content/Script/GameTestApi/QuestApi.lua')
  assert.deepEqual(
    r.items.map((x) => x.name),
    ['项目.QuestApi.Finish', '项目.QuestApi.Gold', '项目.QuestApi.Reset'],
  )
  const fin = r.items[0]
  assert.equal(fin.category, '任务')
  assert.equal(fin.note, '完成任务（直接改存档里的任务状态）')
  assert.deepEqual(fin.args, [
    { name: 'questId', type: 'integer', note: '任务 Id' },
    { name: 'force', type: 'boolean', note: '已完成也再走一遍' },
  ])
  assert.equal(fin.returns, 'boolean')
  assert.equal(fin.readOnly, false)
  assert.equal(fin.line, 10)
  assert.equal(r.items[1].readOnly, true)
  assert.deepEqual(r.items[2].args, [{ name: 'slot' }])
  assert.deepEqual(
    r.rejected.map((x) => `${x.function}:${x.why}`),
    ['_Private:private', 'Log:varargs'],
  )
})
