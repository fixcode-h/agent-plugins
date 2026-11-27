// 写法建议（checks/style/）：Agent 写的「一项一个节点」的脚本能被逐条指出来，写紧凑的脚本不报。
// 用法：node scripts/test.mjs ue server/uekit/gt-author/style.test.ts
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { style } from './checks/style/index.ts'
import { makeEnv, runChecks } from './validate.ts'

const T = '项目.CgApi'

async function root() {
  const dir = await mkdtemp(path.join(tmpdir(), 'gt-style-'))
  const scen = path.join(dir, 'GameTest')
  await mkdir(path.join(scen, 'regression', 'cg'), { recursive: true })
  await writeFile(
    path.join(scen, '_api.json'),
    JSON.stringify({
      lua: {
        items: [
          { name: `${T}.Count`, readOnly: true },
          { name: `${T}.State`, readOnly: true },
          { name: `${T}.Spawn`, readOnly: false },
        ],
      },
    }),
  )
  return scen
}

const prep = [
  { id: 'p1', action: 'api', api: `${T}.Spawn`, args: { id: 1 } },
  { id: 'p2', action: 'wait', until: 'cond', cond: { api: `${T}.State`, equals: 1 }, timeoutMs: 5000 },
  { id: 'p3', action: 'key', key: 'E' },
  { id: 'p4', action: 'click', target: { obj: 'dlg', part: 'BtnAccept' } },
]

async function warn(scen: string, doc: Record<string, unknown>, self = '') {
  const env = makeEnv(doc, self, scen, path.join(scen, '..', 'Script'))
  const r = await runChecks([style], env)
  assert.equal(r.errors.length, 0)
  return r.warnings.map((w) => `${w.code}${'id' in w && w.id ? `@${w.id}` : ''}`).sort()
}

test('一项一个节点的写法逐条报出来', async () => {
  const scen = await root()
  const doc = {
    kind: 'gametest-scenario',
    schemaVersion: 5,
    steps: [
      { id: 's1', action: 'wait', until: 'seconds', seconds: 3 },
      { id: 's2', action: 'api', api: `${T}.Count`, args: { name: 'A' }, saveAs: 'n' },
      { id: 's3', action: 'assert', expr: '$n == 1' },
      { id: 's4', action: 'api', api: `${T}.Count`, args: { name: 'B' }, expect: { equals: 1 } },
      { id: 's5', action: 'api', api: `${T}.State`, expect: { equals: 4 } },
      { id: 's6', action: 'assert', expr: `${T}.Count('C') == 0` },
      { id: 's7', action: 'api', api: 'Gm.Lua', args: { code: 'require("x")' } },
      { id: 's8', action: 'loop', until: { api: `${T}.State`, equals: 1 }, do: [{ action: 'key', key: 'E' }] },
    ],
  }
  assert.deepEqual(await warn(scen, doc), [
    'style_assert_run@s3',
    'style_fixed_wait@s1',
    'style_inline_lua@s7',
    'style_loop_no_max@s8',
    'style_save_then_assert@s2',
  ])
})

test('写紧凑的脚本不报', async () => {
  const scen = await root()
  const doc = {
    kind: 'gametest-scenario',
    schemaVersion: 5,
    steps: [
      { id: 's1', action: 'wait', until: 'cond', cond: { api: `${T}.State`, equals: 4 }, timeoutMs: 5000 },
      {
        id: 's2',
        action: 'assert',
        cond: {
          all: [
            { api: `${T}.Count`, args: { name: 'A' }, equals: 1 },
            { api: `${T}.State`, equals: 4 },
          ],
        },
      },
      // 存下来后面还要用的变量不算
      { id: 's3', action: 'api', api: `${T}.Count`, args: { name: 'A' }, saveAs: 'n0' },
      { id: 's4', action: 'assert', expr: '$n0 >= 0' },
      { id: 's5', action: 'key', key: 'E' },
      { id: 's6', action: 'assert', expr: `${T}.Count('A') > $n0` },
      { id: 's7', action: 'loop', until: { api: `${T}.State`, equals: 1 }, max: 30, do: [{ action: 'key', key: 'E' }] },
      // 改状态的接口带 expect 不算检查
      { id: 's8', action: 'api', api: `${T}.Spawn`, expect: { equals: true } },
      { id: 's9', action: 'api', api: `${T}.Spawn`, expect: { equals: true } },
      { id: 's10', action: 'api', api: `${T}.Spawn`, expect: { equals: true } },
    ],
  }
  assert.deepEqual(await warn(scen, doc), [])
})

test('录制段里的固定等待不报', async () => {
  const scen = await root()
  const doc = {
    kind: 'gametest-scenario',
    schemaVersion: 5,
    steps: [
      { id: 'g1', action: 'group', recorded: true, do: [{ id: 'w1', action: 'wait', until: 'seconds', seconds: 1 }] },
    ],
  }
  assert.deepEqual(await warn(scen, doc), [])
})

test('和同目录脚本开头重复、长脚本不分段', async () => {
  const scen = await root()
  await writeFile(
    path.join(scen, 'regression', 'cg', '超时.json'),
    JSON.stringify({ kind: 'gametest-scenario', schemaVersion: 5, steps: [...prep, { action: 'key', key: 'Q' }] }),
  )
  const tail = Array.from({ length: 13 }, (_, i) => ({ id: `t${i}`, action: 'key', key: 'E' }))
  // id、title、note 不同也算同一步
  const mine = prep.map((s) => ({ ...s, id: `${s.id}x`, title: '准备' }))
  const doc = { kind: 'gametest-scenario', schemaVersion: 5, steps: [...mine, ...tail] }
  assert.deepEqual(await warn(scen, doc, 'regression/cg/正常.json'), ['style_dup_prefix', 'style_flat_long'])
  // 准备段提成子脚本后两条都不报
  const tidy = {
    kind: 'gametest-scenario',
    schemaVersion: 5,
    steps: [{ id: 'c1', action: 'call', script: 'common/进玩法' }, ...tail],
  }
  assert.deepEqual(await warn(scen, tidy, 'regression/cg/正常.json'), [])
})

test('和公共库一样的一段提示改成 call', async () => {
  const scen = await root()
  await mkdir(path.join(scen, 'common', '地图'), { recursive: true })
  const enter = [
    {
      action: 'wait',
      until: 'cond',
      cond: { obj: { class: 'WBP_Loading' }, prop: '@:onScreen', op: 'is', value: true },
    },
    {
      action: 'wait',
      until: 'cond',
      cond: { obj: { class: 'WBP_Loading' }, prop: '@:onScreen', op: 'is', value: false },
    },
  ]
  await writeFile(
    path.join(scen, 'common', '地图', '等加载完.json'),
    JSON.stringify({ kind: 'gametest-scenario', schemaVersion: 5, title: '等加载完', steps: enter }),
  )
  const doc = {
    kind: 'gametest-scenario',
    schemaVersion: 5,
    steps: [
      { id: 'a', action: 'key', key: 'M' },
      ...enter.map((s, i) => ({ ...s, id: `w${i}` })),
      { id: 'b', action: 'key', key: 'E' },
    ],
  }
  assert.deepEqual(await warn(scen, doc, 'regression/x.json'), ['style_library_match@w0'])
  const { gtLibrary } = await import('./library.ts')
  const lib = await gtLibrary(scen, {})
  assert.equal(lib.total, 1)
  assert.equal(lib.items[0].script, 'common/地图/等加载完')
  assert.equal(lib.items[0].folder, '地图')
})
