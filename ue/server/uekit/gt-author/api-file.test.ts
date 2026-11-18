// 项目 Lua 接口扫描和 _api.json 的 lua 段（api-lua.ts、api-file.ts）：认什么、拒什么、只写 lua 段、没变不写、改名。
// 用法：node --test ue/server/uekit/gt-author/api-file.test.ts
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { writeLuaApi } from './api-file.ts'

const QUEST = `local M = {}

---接任务（测试准备状态用）
---@param questId integer 任务 id
---@return boolean
function M.Accept(questId) end

---@readonly
---@param questId integer
---@return boolean
function M.IsDone(questId) end

function M:Bad() end
function M._private() end
---@param cb fun()
function M.WithCb(cb) end
return M
`

test('扫 GameTestApi 文件夹，写 lua 段，保留 cpp 段，没变不写，改名记 renamed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gt-api-'))
  const lua = path.join(dir, 'Script')
  const scen = path.join(dir, 'docs', 'GameTest')
  await mkdir(path.join(lua, 'Game', 'GameTestApi'), { recursive: true })
  await mkdir(scen, { recursive: true })
  await writeFile(path.join(lua, 'Game', 'GameTestApi', 'QuestApi.lua'), QUEST)
  await writeFile(path.join(scen, '_settings.json'), JSON.stringify({ api: { lua: ['**/GameTestApi', 'Nope'] } }))
  await writeFile(path.join(scen, '_api.json'), JSON.stringify({ kind: 'gametest-api', version: 1, cpp: { items: [1] } }))

  const r = await writeLuaApi(scen, lua)
  assert.equal(r.written, true)
  assert.deepEqual(r.counts, { items: 2, rejected: 3 })
  assert.deepEqual(r.missing, ['Nope'])
  const doc = JSON.parse(await readFile(path.join(scen, '_api.json'), 'utf8'))
  assert.deepEqual(doc.cpp, { items: [1] })
  const accept = doc.lua.items.find((x: { function: string }) => x.function === 'Accept')
  assert.equal(accept.name, '项目.QuestApi.Accept')
  assert.equal(accept.module, 'Game.GameTestApi.QuestApi')
  assert.deepEqual(accept.args, [{ name: 'questId', type: 'int', note: '任务 id' }])
  assert.equal(accept.returns, 'bool')
  assert.equal(doc.lua.items.find((x: { function: string }) => x.function === 'IsDone').readOnly, true)
  assert.ok(doc.lua.rejected.every((x: { why: string }) => x.why))

  const t1 = (await stat(path.join(scen, '_api.json'))).mtimeMs
  const again = await writeLuaApi(scen, lua)
  assert.equal(again.written, false)
  assert.equal((await stat(path.join(scen, '_api.json'))).mtimeMs, t1)

  await writeFile(path.join(lua, 'Game', 'GameTestApi', 'QuestApi.lua'), QUEST.replace('M.Accept', 'M.AcceptQuest'))
  const ren = await writeLuaApi(scen, lua)
  assert.deepEqual(ren.renamed, { '项目.QuestApi.Accept': '项目.QuestApi.AcceptQuest' })
})

test('没有 _settings.json 时按默认 GameTestApi（脚本根下）', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gt-api-'))
  await mkdir(path.join(dir, 'Script', 'GameTestApi'), { recursive: true })
  await writeFile(path.join(dir, 'Script', 'GameTestApi', 'Bag.lua'), 'local B = {}\nfunction B.Add(id, n) end\nreturn B\n')
  const r = await writeLuaApi(dir, path.join(dir, 'Script'), true)
  assert.equal(r.written, false)
  assert.equal(r.counts.items, 1)
  assert.equal((r.section.items as { name: string }[])[0].name, '项目.Bag.Add')
})

test('技能里的 Lua 接口示例能被认出来（示例和扫描规则对得上）', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gt-api-'))
  await mkdir(path.join(dir, 'Script', 'GameTestApi'), { recursive: true })
  const example = await readFile(
    path.join(import.meta.dirname, '../../../skills/engineering/ue-gametest-authoring/reference/lua-api-example.lua'),
    'utf8',
  )
  await writeFile(path.join(dir, 'Script', 'GameTestApi', 'QuestTestApi.lua'), example)
  const r = await writeLuaApi(dir, path.join(dir, 'Script'), true)
  const items = r.section.items as { name: string; readOnly: boolean }[]
  assert.deepEqual(
    items.map((x) => `${x.name}:${x.readOnly}`),
    [
      '项目.QuestTestApi.Accept:false',
      '项目.QuestTestApi.SetProgress:false',
      '项目.QuestTestApi.IsDone:true',
      '项目.QuestTestApi.Progress:true',
      '项目.QuestTestApi.Cleanup:false',
    ],
  )
  assert.deepEqual(
    (r.section.rejected as { function: string }[]).map((x) => x.function),
    ['_debugDump'],
  )
})
