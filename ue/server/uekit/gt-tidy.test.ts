// GameTest「AI 整理」的整理稿：路径、读稿、保存时备份原录制、改过就拒绝、恢复（gt-tidy.ts）。
// 用法：node --test ue/server/uekit/gt-tidy.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { setCtx } from '../util.ts'
import { mergeScenario, parseDraft, tidyAction } from './gt-tidy.ts'

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

test('整理稿：认外面包一层的写法，也认直接写整份场景；没有步骤报错', () => {
  const d = parseDraft({
    summary: 's',
    changes: [{ what: '删重复点击', from: [4], to: [] }, { what: '' }],
    scenario: { name: 'x', steps: [{ action: 'click', note: '打开 GM' }] },
  })
  assert.equal(d.changes.length, 1)
  assert.deepEqual(d.changes[0], { what: '删重复点击', from: [4], to: [] })
  assert.equal(parseDraft({ name: 'x', steps: [{ action: 'ping' }] }).scenario.steps.length, 1)
  assert.throws(() => parseDraft({ scenario: { steps: [] } }))
  assert.throws(() => parseDraft({ scenario: { steps: [{ note: 'x' }] } }))
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

test('流程：prepare 给路径 → 读稿带 hash → 保存备份原录制 → 再整理不覆盖备份 → 恢复', async () => {
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

  const p = await call('prepare')
  const draft = String(p.draftPath)
  assert.ok(draft.endsWith('Saved/GameTest/tidy/recorded/gm.json'), draft)
  assert.equal((await call('status')).draft, false)
  await assert.rejects(call('load'))

  await writeFile(
    draft,
    JSON.stringify({
      summary: '去掉重复点击',
      scenario: { steps: [{ action: 'click', target: 'A', note: '打开 GM' }] },
    }),
  )
  const l = await call('load')
  assert.equal((l.original as unknown[]).length, 2)
  // 看差异之后场景被改了：不保存
  await assert.rejects(call('apply', { hash: 'old' }))
  const r = await call('apply', { hash: l.hash })
  assert.equal(r.keptOldBackup, false)
  assert.equal(await readFile(`${file}.bak`, 'utf8'), orig)
  const saved = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(saved.steps[0].note, '打开 GM')
  assert.equal(saved.revision, 1)
  assert.equal(await has(draft), false)
  assert.equal((await call('status')).backup, 'recorded/gm.json.bak')

  // 再整理一次：最早的原录制备份不被覆盖
  await call('prepare')
  await writeFile(draft, JSON.stringify({ scenario: { steps: [{ action: 'ping', note: 'x' }] } }))
  const l2 = await call('load')
  assert.equal((await call('apply', { hash: l2.hash })).keptOldBackup, true)
  assert.equal(await readFile(`${file}.bak`, 'utf8'), orig)

  await call('restore')
  assert.equal(await readFile(file, 'utf8'), orig)
  assert.equal((await call('status')).backup, '')
})
