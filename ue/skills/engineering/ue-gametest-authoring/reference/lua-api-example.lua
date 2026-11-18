--[[
GameTest 项目 Lua 接口示例（放在 Lua 脚本根下的 GameTestApi 文件夹，例如 Content/Script/GameTestApi/QuestTestApi.lua）。
面板按文件扫描，模块表上的函数就是接口，名字是「项目.QuestTestApi.<函数名>」，测试脚本里这样用：

  { "action": "api", "api": "项目.QuestTestApi.Accept", "args": { "questId": 1203 }, "saveAs": "ok" }
  { "action": "if", "cond": { "api": "项目.QuestTestApi.IsDone", "args": { "questId": 1203 }, "equals": true }, "then": [ … ] }
  { "action": "assert", "expr": "项目.QuestTestApi.Progress(1203) >= 3" }

认的规则：
- 只认模块函数 function M.Fn(...)；function M:Fn(...) 是方法（要 self），不进接口库。
- 名字以 _ 开头的当私有，不进接口库；local function 只是内部帮助函数。
- 参数和返回值照 EmmyLua 注释：---@param 名 类型 说明、---@return 类型 说明。类型用 integer / number / string / boolean / table；
  fun() / function / userdata 构造不出来，这样的函数会列进「没认出来的」。
- ---@readonly：只查询、不改游戏状态，能写进条件和表达式；不标的只能当步骤（api）调。
- 函数上面紧挨着的普通注释是说明，Agent 和接口库页都会显示。

下面 require 的模块名、管理器的函数都只是示意：项目的 UnLua 是二次开发版，取游戏对象、调 C++ 的写法照项目里已有的代码写，
不要照官方 UnLua 的 API 猜。接口只做「准备状态」和「查询」，逻辑写在这里，测试脚本只做编排。
]]

local QuestMgr = require("Game.Quest.QuestMgr") -- 示意：换成项目里管任务的真实模块

local M = {}

---直接接取任务（测试准备状态用，跳过 NPC 对话）
---@param questId integer 任务 Id（配置表里的 Id）
---@param force boolean? 已经接过时是否重置后重新接，默认 false
---@return boolean 接取成功
function M.Accept(questId, force)
    if force then
        QuestMgr:Abandon(questId)
    end
    return QuestMgr:Accept(questId) == true
end

---把任务的计数类目标推进到指定值（打怪、收集这类，省得在测试里真去打）
---@param questId integer 任务 Id
---@param count integer 推进到第几个
function M.SetProgress(questId, count)
    local quest = QuestMgr:Get(questId)
    if not quest then
        -- 出错直接 error：GameTest 会把这句当成这一步的失败原因写进报告
        error(string.format("任务 %d 还没接", questId))
    end
    quest:SetProgress(count)
end

---任务完成了没有
---@readonly
---@param questId integer 任务 Id
---@return boolean
function M.IsDone(questId)
    local quest = QuestMgr:Get(questId)
    return quest ~= nil and quest:IsDone()
end

---任务当前进度（没接时 -1）
---@readonly
---@param questId integer 任务 Id
---@return integer
function M.Progress(questId)
    local quest = QuestMgr:Get(questId)
    return quest and quest:GetProgress() or -1
end

---测试结束后清掉这次接的任务，下一次从干净状态开始
---@param questIds table 任务 Id 列表，例如 [1203, 1204]
function M.Cleanup(questIds)
    for _, id in ipairs(questIds) do
        QuestMgr:Abandon(id)
    end
end

-- 内部帮助函数：local 的不算接口
local function log(fmt, ...)
    print("[GameTestApi] " .. string.format(fmt, ...))
end

-- 下划线开头：约定私有，不进接口库
function M._debugDump()
    log("%s", tostring(QuestMgr))
end

return M
