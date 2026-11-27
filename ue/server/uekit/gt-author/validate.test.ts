// 离线校验（编辑器没开时的 ue_gametest action=validate）：检查表逐项能报出协议第 12 节的错误码。
// 用法：node --test ue/server/uekit/gt-author/validate.test.ts
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { offlineChecks } from './checks/index.ts'
import { makeEnv, runChecks } from './validate.ts'

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'gt-val-'))
  const scen = path.join(dir, 'GameTest')
  const lua = path.join(dir, 'Script')
  await mkdir(path.join(scen, 'common'), { recursive: true })
  await mkdir(path.join(lua, 'Game', 'Guide'), { recursive: true })
  await writeFile(
    path.join(scen, 'common', '翻完引导.json'),
    JSON.stringify({
      kind: 'gametest-scenario',
      schemaVersion: 3,
      params: { max: { default: 30 } },
      steps: [{ action: 'key', key: 'E' }],
    }),
  )
  await writeFile(path.join(scen, 'a.json'), JSON.stringify({ steps: [{ action: 'call', script: 'b' }] }))
  await writeFile(path.join(scen, 'b.json'), JSON.stringify({ steps: [{ action: 'call', script: 'a' }] }))
  await writeFile(
    path.join(scen, '_api.json'),
    JSON.stringify({
      lua: { items: [{ name: '项目.QuestApi.Accept' }] },
      renamed: { '项目.QuestApi.Old': '项目.QuestApi.Accept' },
    }),
  )
  await writeFile(path.join(lua, 'Game', 'Guide', 'GuideMgr.lua'), 'local M = {}\nM.curStep = 1\nreturn M\n')
  return { scen, lua }
}

// 没写名称 / 说明的警告（no_title / no_note）单独测：别的用例的脚本为了短都没写，不算进来
const NAMING = new Set(['no_title', 'no_note'])
const codes = (r: { errors: { code: string }[]; warnings: { code: string }[] }) => ({
  errors: r.errors.map((x) => x.code).sort(),
  warnings: r.warnings
    .map((x) => x.code)
    .filter((c) => !NAMING.has(c))
    .sort(),
})

test('一份写对了的 v5 脚本没有错误', async () => {
  const { scen, lua } = await setup()
  const doc = {
    kind: 'gametest-scenario',
    schemaVersion: 5,
    vars: { gold0: 0 },
    guards: [
      {
        id: 'g1',
        when: { obj: { class: 'WBP_Guide' }, prop: '@:onScreen', op: 'is', value: true },
        do: [{ action: 'call', script: 'common/翻完引导' }],
      },
    ],
    steps: [
      { id: 's1', action: 'api', api: '项目.QuestApi.Accept', args: { questId: 1203 }, saveAs: 'ok' },
      { id: 's2', action: 'set', var: 'gold0', value: '=@ps.Gold' },
      {
        id: 'loop1',
        action: 'loop',
        until: { expr: '@luaMod.Game.Guide.GuideMgr.curStep >= 3' },
        max: 30,
        do: [{ id: 's3', action: 'key', key: 'E' }],
      },
      { id: 's4', action: 'assert', expr: '@ps.Gold >= $gold0 + 500 and $ok' },
    ],
  }
  const r = await runChecks(offlineChecks(), makeEnv(doc, 'x.json', scen, lua))
  assert.deepEqual(codes(r), { errors: [], warnings: [] })
})

test('常见写错的地方都按错误码报出来', async () => {
  const { scen, lua } = await setup()
  const doc = {
    schemaVersion: 5,
    blockers: [],
    steps: [
      { id: 's1', action: 'loop', until: { visible: true }, max: -1, do: [{ id: 's1', action: 'key', key: 'E' }] },
      { action: 'call', script: 'common/没有这个' },
      { action: 'call', script: 'common/翻完引导', with: { mxa: 3 } },
      { action: 'call', script: 'a' },
      { action: 'set', var: 'x', value: '=$y + (1' },
      { action: 'assert', expr: 'foo(1) > 0' },
      { action: 'api', api: '项目.QuestApi.Old' },
      { action: 'api', api: '项目.QuestApi.Nope' },
      { action: 'clik', target: { obj: { class: 'WBP' }, part: 'Btn' } },
      { action: 'assert', expr: '@luaMod.Game.Guide.GuideMgr.nope == 1' },
    ],
  }
  const r = await runChecks(offlineChecks(), makeEnv(doc, 'x.json', scen, lua))
  const c = codes(r)
  for (const code of [
    'blockers_removed',
    'bad_type',
    'dup_id',
    'call_missing',
    'param_missing',
    'call_cycle',
    'expr_syntax',
    'fn_missing',
    'api_renamed',
    'api_missing',
  ])
    assert.ok(c.errors.includes(code), `少了 ${code}：${JSON.stringify(c)}`)
  assert.ok(c.warnings.includes('unknown_action'))
  assert.ok(c.warnings.includes('path_missing'))
  // $y 写在有语法错的表达式里：语法错先报，变量检查照样按文字认出来
  assert.ok(r.errors.some((x) => x.code === 'var_undefined' && x.message.includes('$y')))
})

test('引用写了 client（GameTest 还没做）给警告，不当错误', async () => {
  const { scen, lua } = await setup()
  const doc = {
    kind: 'gametest-scenario',
    schemaVersion: 5,
    objects: { npc: { class: 'BP_Npc_C', client: 1 } },
    steps: [
      { id: 's1', action: 'obj.call', obj: { class: 'BP_Shop_C', client: 0 }, function: 'Open' },
      { id: 's2', action: 'group', do: [{ id: 's3', action: 'obj.call', obj: 'npc', function: 'Talk' }] },
    ],
  }
  const r = await runChecks(offlineChecks(), makeEnv(doc, 'x.json', scen, lua))
  assert.deepEqual(codes(r), { errors: [], warnings: ['not_supported', 'not_supported'] })
  assert.deepEqual(
    r.warnings
      .filter((w) => !NAMING.has(w.code))
      .map((w) => w.path)
      .sort(),
    ['objects.npc', 'steps.0'],
  )
})

test('每一步要写名称（title）和说明（note）：没写的合成一条警告，列出步骤', async () => {
  const { scen, lua } = await setup()
  const doc = {
    kind: 'gametest-scenario',
    schemaVersion: 5,
    steps: [
      { id: 's1', action: 'key', key: 'E', title: '按交互键', note: '靠近 NPC 后按 E 打开对话' },
      { id: 's2', action: 'key', key: 'E', note: '只有说明' },
      { id: 'g1', action: 'group', title: '收尾', do: [{ id: 's3', action: 'key', key: 'Escape' }] },
    ],
  }
  const r = await runChecks(offlineChecks(), makeEnv(doc, 'x.json', scen, lua))
  const title = r.warnings.find((w) => w.code === 'no_title')
  const note = r.warnings.find((w) => w.code === 'no_note')
  assert.match(String(title?.message), /s2、s3/)
  assert.match(String(note?.message), /g1、s3/)
  assert.ok(!r.errors.length)
})
