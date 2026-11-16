/**
 * AssetForge 自动建配置根、模板新建配置：只在项目和 ProjectDoc 里建，不覆盖已有配置，出了配置根拒绝。
 * forge-files.ts 经 instances.ts 间接引到面板模块，要挂面板解析钩子跑：
 * AGENT_PLUGIN_PANEL=../.panel AGENT_PLUGIN_DIR=$PWD node --import ../scripts/lib/panel-register.mjs --test server/uekit/forge-files.test.ts（在 ue/ 下）
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { setCtx } from '../util.ts'
import { forgeCreateConfig, forgeEnsureRoot } from './forge-files.ts'

let base = ''
let proj = ''

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-forge-files-'))
  proj = path.join(base, 'Game')
  setCtx({
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})
after(() => rm(base, { recursive: true, force: true }))

test('配置根不存在时建出来，项目外层 ProjectDoc 里也行，别处拒绝', async () => {
  await forgeEnsureRoot(proj, { root: 'docs/AssetForge' })
  assert.ok((await stat(path.join(proj, 'docs', 'AssetForge'))).isDirectory())
  await forgeEnsureRoot(proj, { root: path.join(base, 'ProjectDoc', 'docs', 'AssetForge') })
  assert.ok((await stat(path.join(base, 'ProjectDoc', 'docs', 'AssetForge'))).isDirectory())
  await assert.rejects(forgeEnsureRoot(proj, { root: path.join(base, 'Other') }))
})

test('新建配置：写进配置根、建好子目录，已有的不覆盖', async () => {
  const root = 'docs/AssetForge'
  const r = await forgeCreateConfig(proj, { root, path: 'umg/UI/WBP_A.json', text: '{"kind":"umg-widget"}\n' })
  assert.equal(r.path, 'umg/UI/WBP_A.json')
  assert.equal(await readFile(path.join(proj, root, 'umg', 'UI', 'WBP_A.json'), 'utf8'), '{"kind":"umg-widget"}\n')
  await assert.rejects(forgeCreateConfig(proj, { root, path: 'umg/UI/WBP_A.json', text: '{}' }), /已经有这份配置/)
  // 没有 text：只建目录（让 AI 写之前），告诉页面文件在不在
  const d = await forgeCreateConfig(proj, { root, path: 'bt/AI/BT_B.json' })
  assert.equal(d.exists, false)
  assert.ok((await stat(path.join(proj, root, 'bt', 'AI'))).isDirectory())
  await assert.rejects(forgeCreateConfig(proj, { root, path: '../x.json', text: '{}' }))
  await assert.rejects(forgeCreateConfig(proj, { root, path: 'umg/a.txt', text: '{}' }))
})
