// AssetForge 自带的 GameTest 用例（UEKit plugins/AssetForge/docs/AssetForge/Test/_GameTest/ 的副本，放在 fixtures/forge-sample/，含 common/ 子脚本）
// 必须在面板这边也能解析：离线列表曾把格式上限写成 2，v3 的用例全标「解析失败」（2026-11-18 用户报）。
// UEKit 那边改了用例（docs/asset-forge-sample/gen.mjs 生成）就把整个目录拷过来再跑。用法：node --test ue/server/uekit/gt-samples.test.ts
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { parseScript, toV4WithTodos } from '../../shared/gt-script/script.ts'
import { setCtx } from '../util.ts'
import { offlineChecks } from './gt-author/checks/index.ts'
import { makeEnv, runChecks } from './gt-author/validate.ts'
import { gtFromDisk } from './gt-disk.ts'

const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'forge-sample')
const FILES = [
  'ForgeSample-冒烟.json',
  'ForgeSample-控件操作.json',
  'ForgeSample-条目标识.json',
  'ForgeSample-流程脚本.json',
  'ForgeSample-真实输入.json',
  'common/打开示例界面.json',
]

/** 示例用例装在场景根的 AssetForgeSample/ 下（AssetForge 的 ForgeSamples 这么拷），call 的路径按这个写 */
async function sampleRoot(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  await cp(SAMPLES, path.join(root, 'AssetForgeSample'), { recursive: true })
  return root
}

before(() => {
  setCtx({
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})

test('自带用例都在', async () => {
  const files = (await readdir(SAMPLES, { recursive: true }))
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f.endsWith('.json'))
    .sort()
  assert.deepEqual(files, [...FILES].sort())
})

// 用例还是 v3（UEKit 那边没重新生成）：先按「升级脚本」迁到 v4 再校验，迁移后的脚本要能过离线校验（迁不准的只是 migrate_todo 警告）
test('脚本格式解析得了、迁到 v4 后离线校验没有错误', async () => {
  const scen = await sampleRoot('gt-samples-')
  for (const f of FILES) {
    const r = parseScript(await readFile(path.join(SAMPLES, f), 'utf8'))
    assert.ok('doc' in r, `${f}：${'error' in r ? r.error : ''}`)
    const v4 = toV4WithTodos(r.doc).doc
    const checked = await runChecks(offlineChecks(), makeEnv(v4 as never, `AssetForgeSample/${f}`, scen, scen))
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
  assert.equal(r.scenarios.length, FILES.length)
  for (const s of r.scenarios) {
    assert.equal(s.parseError, undefined, `${s.relativePath}：${s.parseError}`)
    assert.ok(s.steps > 0)
  }
})
