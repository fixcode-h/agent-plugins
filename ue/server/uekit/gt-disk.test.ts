// GameTest 页离线：编辑器没开时场景、最近运行、历史、报告从磁盘读（gt-disk.ts）。
// 用法：node --test ue/server/uekit/gt-disk.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { setCtx } from '../util.ts'
import { gtFromDisk, scenarioRoot } from './gt-disk.ts'
import { gtVerdict } from './gt-verdict.ts'

let base = ''
const json = async (file: string, v: unknown) => {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(v, null, '\t'))
}
const scen = (name: string, extra: Record<string, unknown> = {}) => ({
  kind: 'gametest-scenario',
  schemaVersion: 2,
  name,
  steps: [{ action: 'ping' }, { action: 'wait', seconds: 1 }],
  ...extra,
})

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-gt-disk-'))
  setCtx({
    dataDir: path.join(base, 'data'),
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})

test('场景根：默认 docs/GameTest，外层有 ProjectDoc/docs 用它，DefaultGame.ini 设了按设置', async () => {
  const root = path.join(base, 'a', 'Game')
  await mkdir(root, { recursive: true })
  assert.equal(await scenarioRoot(root), path.join(root, 'docs', 'GameTest'))
  await mkdir(path.join(base, 'a', 'ProjectDoc', 'docs'), { recursive: true })
  assert.equal(await scenarioRoot(root), path.join(base, 'a', 'ProjectDoc', 'docs', 'GameTest'))
  await mkdir(path.join(root, 'Config'), { recursive: true })
  await writeFile(
    path.join(root, 'Config', 'DefaultGame.ini'),
    '[/Script/GameTest.GameTestSettings]\nScenarioRootDir=Tests/GT\n',
  )
  assert.equal(await scenarioRoot(root), path.join(root, 'Tests', 'GT'))
})

test('场景列表：按相对路径排序，坏场景带 parseError，tags / revision 照 UE 读', async () => {
  const root = path.join(base, 'b')
  const sr = path.join(root, 'docs', 'GameTest')
  await json(path.join(sr, 'smoke', 'main.json'), scen('主菜单', { tags: ['smoke', ' ', 3], revision: 4 }))
  await json(path.join(sr, 'a.json'), { kind: 'gametest-scenario', schemaVersion: 4, name: 'x', steps: [] })
  await mkdir(sr, { recursive: true })
  await writeFile(path.join(sr, 'broken.json'), '{ nope')
  const r = (await gtFromDisk(root, 'gt.scenarios', { limit: 1000 })) as unknown as {
    scenarios: {
      name: string
      relativePath: string
      steps: number
      tags: string[]
      revision: number
      parseError?: string
    }[]
    rootDir: string
    offline: boolean
  }
  assert.equal(r.offline, true)
  assert.equal(r.rootDir, 'docs/GameTest')
  assert.deepEqual(
    r.scenarios.map((s) => s.relativePath),
    ['a.json', 'broken.json', 'smoke/main.json'],
  )
  const [bad, broken, ok] = r.scenarios
  assert.match(bad.parseError ?? '', /schemaVersion 4/)
  assert.match(bad.parseError ?? '', /steps/)
  assert.ok(broken.parseError)
  assert.equal(ok.name, '主菜单')
  assert.equal(ok.steps, 2)
  assert.deepEqual(ok.tags, ['smoke'])
  assert.equal(ok.revision, 4)
  assert.equal(ok.parseError, undefined)
})

test('最近运行、历史、报告：读 Saved/GameTest，旧报告不算验证结论', async () => {
  const root = path.join(base, 'c')
  const out = path.join(root, 'Saved', 'GameTest')
  const report = {
    runId: 'main-1',
    name: '主菜单',
    scenario: 'smoke/main.json',
    succeeded: false,
    startedAtUtc: '2026-11-15T08:00:00Z',
    total: 2,
    failed: 1,
    steps: [
      { index: 0, status: 'passed' },
      { index: 1, status: 'failed' },
    ],
  }
  await json(path.join(out, '主菜单-20261115-080000', 'report.json'), report)
  await json(path.join(out, 'history.json'), {
    scenarios: {
      'smoke/main.json': [
        { runId: 'main-1', succeeded: false, outputDir: 'Saved/GameTest/主菜单-20261115-080000' },
        { runId: 'main-0', succeeded: true },
      ],
    },
  })
  const runs = (await gtFromDisk(root, 'gt.runs', {})) as unknown as { runs: Record<string, unknown>[] }
  assert.equal(runs.runs.length, 1)
  assert.equal(runs.runs[0].runId, 'main-1')
  assert.equal(runs.runs[0].outputDir, 'Saved/GameTest/主菜单-20261115-080000')
  assert.equal('steps' in runs.runs[0], false)

  const hist = (await gtFromDisk(root, 'gt.history', {})) as unknown as { scenarios: Record<string, string> }
  assert.deepEqual(hist.scenarios, { 'smoke/main.json': 'fp' })
  const one = (await gtFromDisk(root, 'gt.history', { scenario: 'smoke\\main.json' })) as unknown as { runs: unknown[] }
  assert.equal(one.runs.length, 2)

  const rep = await gtFromDisk(root, 'gt.report', { runId: 'main-1' })
  assert.equal((rep as unknown as { steps: unknown[] }).steps.length, 2)
  assert.equal(gtVerdict(rep), undefined)
  await assert.rejects(gtFromDisk(root, 'gt.report', { runId: 'nope' }), /找不到/)
})

test('报告太长：只回摘要和 file，和 UE 的写法一样', async () => {
  const root = path.join(base, 'd')
  const steps = Array.from({ length: 400 }, (_, i) => ({ index: i, status: 'passed', message: 'x'.repeat(40) }))
  await json(path.join(root, 'Saved', 'GameTest', 'big-1', 'report.json'), { runId: 'big', name: 'big', steps })
  const r = (await gtFromDisk(root, 'gt.report', { runId: 'big' })) as unknown as Record<string, unknown>
  assert.equal(r.truncated, true)
  assert.equal(r.file, 'Saved/GameTest/big-1/report.json')
  assert.equal(r.steps, undefined)
})
