// AssetForge 自带的两份 GameTest 用例（UEKit plugins/AssetForge/docs/AssetForge/Test/_GameTest/ 的副本，放在 fixtures/forge-sample/）
// 必须在面板这边也能解析：离线列表曾把格式上限写成 2，v3 的用例全标「解析失败」（2026-11-18 用户报）。
// UEKit 那边改了用例就把新文件拷过来再跑。用法：node --test ue/server/uekit/gt-samples.test.ts
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { parseScript } from '../../shared/gt-script/script.ts'
import { setCtx } from '../util.ts'
import { offlineChecks } from './gt-author/checks/index.ts'
import { makeEnv, runChecks } from './gt-author/validate.ts'
import { gtFromDisk } from './gt-disk.ts'

const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'forge-sample')

before(() => {
  setCtx({
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})

test('两份自带用例都在', async () => {
  const files = (await readdir(SAMPLES)).filter((f) => f.endsWith('.json')).sort()
  assert.deepEqual(files, ['ForgeSample-冒烟.json', 'ForgeSample-条目标识.json'])
})

test('脚本格式解析得了、离线校验没有错误', async () => {
  const scen = await mkdtemp(path.join(tmpdir(), 'gt-samples-'))
  for (const f of (await readdir(SAMPLES)).filter((x) => x.endsWith('.json'))) {
    const r = parseScript(await readFile(path.join(SAMPLES, f), 'utf8'))
    assert.ok('doc' in r, `${f}：${'error' in r ? r.error : ''}`)
    const checked = await runChecks(offlineChecks(), makeEnv(r.doc as never, `AssetForgeSample/${f}`, scen, scen))
    assert.deepEqual(
      checked.errors.map((e) => `${e.code} ${JSON.stringify(e)}`),
      [],
      f,
    )
  }
})

test('编辑器没开时场景列表不标「解析失败」', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'gt-samples-proj-'))
  const dir = path.join(root, 'docs', 'GameTest', 'AssetForgeSample')
  await mkdir(dir, { recursive: true })
  await cp(SAMPLES, dir, { recursive: true })
  const r = (await gtFromDisk(root, 'gt.scenarios', { limit: 1000 })) as unknown as {
    scenarios: { relativePath: string; steps: number; parseError?: string }[]
  }
  assert.equal(r.scenarios.length, 2)
  for (const s of r.scenarios) {
    assert.equal(s.parseError, undefined, `${s.relativePath}：${s.parseError}`)
    assert.ok(s.steps > 0)
  }
})
