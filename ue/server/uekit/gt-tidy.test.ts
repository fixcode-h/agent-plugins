// GameTest「AI 整理」：整理方案的校验和应用（gt-tidy-plan.ts）、出题、保存时备份原录制、改过就拒绝、恢复（gt-tidy.ts）。
// 用法：node --test ue/server/uekit/gt-tidy.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { setCtx } from '../util.ts'
import { mergeScenario, tidyAction } from './gt-tidy.ts'
import { applyTidyPlan, parseTidyPlan, tidyBlockOf } from './gt-tidy-plan.ts'

let base = ''
before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-gt-tidy-'))
  setCtx({
    dataDir: path.join(base, 'data'),
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})

const has = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

test('整理方案：校验形状、步骤号越界、两条改动碰同一步都退回', () => {
  const sc = { root: '/r', path: 'a.json' }
  const ok = parseTidyPlan(
    {
      scenario: sc,
      summary: 's',
      review: [{ step: 2, text: '按代码要先领奖' }, { text: '' }],
      changes: [{ what: '重复点击', op: 'delete', steps: [3, 2] }],
      notes: { '1': '打开商店', '9': '越界的不要' },
    },
    4,
  )
  assert.deepEqual(ok.changes[0], { what: '重复点击', op: 'delete', steps: [2, 3] })
  assert.deepEqual(ok.notes, { 1: '打开商店' })
  assert.equal(ok.review.length, 1)
  assert.throws(() => parseTidyPlan({ scenario: sc, changes: [{ what: 'x', op: 'delete', steps: [5] }] }, 4))
  assert.throws(() =>
    parseTidyPlan(
      {
        scenario: sc,
        changes: [
          { what: 'a', op: 'delete', steps: [2] },
          { what: 'b', op: 'edit', step: 2, set: { timeoutMs: 1 } },
        ],
      },
      4,
    ),
  )
  assert.throws(() =>
    parseTidyPlan({ scenario: sc, changes: [{ what: 'x', op: 'replace', steps: [1], with: [{}] }] }, 4),
  )
  assert.throws(() => parseTidyPlan({ changes: [] }, 4))
  assert.equal(tidyBlockOf('前\n```gametest-tidy\n{"a":1}\n```\n后\n```gametest-tidy\n{"a":2}\n```'), '{"a":2}\n')
})

test('应用：只应用勾上的改动，插入、替换、改字段（null 删字段）、说明按原步骤号', () => {
  const orig = [
    { action: 'click', target: 'A' },
    { action: 'click', target: 'A' },
    { action: 'wait', seconds: 2 },
    { action: 'click', target: 'B', via: 'code' },
  ]
  const plan = parseTidyPlan(
    {
      scenario: { root: '/r', path: 'a.json' },
      changes: [
        { what: '重复', op: 'delete', steps: [2] },
        {
          what: '固定等待改等界面',
          op: 'replace',
          steps: [3],
          with: [{ action: 'wait', until: 'widget', target: 'Shop' }],
        },
        { what: '代码点击改真实点击', op: 'edit', step: 4, set: { via: null } },
        { what: '开头先关引导', op: 'insert', after: 0, with: [{ action: 'gm', command: 'skip' }] },
      ],
      notes: { 1: '打开商店', 4: '买第一件' },
    },
    4,
  )
  const all = applyTidyPlan(orig, plan, [0, 1, 2, 3], true)
  assert.deepEqual(
    all.map((s) => s.action),
    ['gm', 'click', 'wait', 'click'],
  )
  assert.equal(all[1].note, '打开商店')
  assert.equal(all[2].until, 'widget')
  assert.equal('via' in all[3], false)
  assert.equal(all[3].note, '买第一件')
  // 只勾第 1 条、不要说明：其余原样
  const some = applyTidyPlan(orig, plan, [0], false)
  assert.equal(some.length, 3)
  assert.equal(some[0].note, undefined)
  assert.equal(orig[3].via, 'code')
})

test('写回：原文件的顶层字段留着，name 不变，revision 加 1，版本只升不降', () => {
  const m = mergeScenario(
    { kind: 'gametest-scenario', schemaVersion: 2, name: '录制', tags: ['recorded'], revision: 3, steps: [] },
    { name: '别的名字', steps: [{ action: 'ping' }] },
  )
  assert.equal(m.name, '录制')
  assert.equal(m.revision, 4)
  assert.deepEqual(m.tags, ['recorded'])
  assert.equal(mergeScenario({ name: 'a', steps: [] }, { steps: [] }).schemaVersion, 1)
  assert.equal(mergeScenario({ name: 'a', steps: [] }, { schemaVersion: 2, steps: [] }).schemaVersion, 2)
})

test('流程：出题带 hash → 场景被改过就拒绝 → 应用备份原录制 → 再应用不覆盖备份 → 恢复', async () => {
  const root = path.join(base, 'proj')
  const sr = path.join(root, 'docs', 'GameTest')
  const file = path.join(sr, 'recorded', 'gm.json')
  await mkdir(path.dirname(file), { recursive: true })
  const orig = JSON.stringify({
    kind: 'gametest-scenario',
    schemaVersion: 2,
    name: 'gm',
    tags: ['recorded'],
    steps: [
      { action: 'click', target: 'A' },
      { action: 'click', target: 'A' },
    ],
  })
  await writeFile(file, orig)
  const call = (action: string, extra: Record<string, unknown> = {}) =>
    tidyAction(root, { root: sr, path: 'recorded/gm.json', action, ...extra }) as Promise<Record<string, unknown>>

  const src = await call('source')
  assert.equal((src.steps as unknown[]).length, 2)
  assert.ok(String(src.scenarioPath).endsWith('docs/GameTest/recorded/gm.json'))
  const plan = {
    scenario: { root: src.root, path: 'recorded/gm.json', hash: src.hash },
    changes: [{ what: '重复点击', op: 'delete', steps: [2] }],
    notes: { 1: '打开 GM' },
  }
  await assert.rejects(call('apply', { hash: 'old', plan, picked: [0], notes: true }))
  await assert.rejects(call('apply', { hash: src.hash, plan: { changes: [] }, picked: [], notes: true }))
  const r = await call('apply', { hash: src.hash, plan, picked: [0], notes: true })
  assert.equal(r.keptOldBackup, false)
  assert.equal(await readFile(`${file}.bak`, 'utf8'), orig)
  const saved = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(saved.steps.length, 1)
  assert.equal(saved.steps[0].note, '打开 GM')
  assert.equal(saved.revision, 1)
  assert.deepEqual(saved.tags, ['recorded'])
  assert.equal((await call('status')).backup, 'recorded/gm.json.bak')

  // 再整理一次：最早的原录制备份不被覆盖
  const src2 = await call('source')
  const r2 = await call('apply', {
    hash: src2.hash,
    plan: { scenario: plan.scenario, changes: [], notes: { 1: '打开 GM 面板' } },
    picked: [],
    notes: true,
  })
  assert.equal(r2.keptOldBackup, true)
  assert.equal(await readFile(`${file}.bak`, 'utf8'), orig)

  await call('restore')
  assert.equal(await readFile(file, 'utf8'), orig)
  assert.equal((await call('status')).backup, '')
})
