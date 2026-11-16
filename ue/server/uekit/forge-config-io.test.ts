/**
 * AssetForge 页编辑配置、项目模板、目标资产检查：中间被改过不覆盖，模板只读 _templates，资产按 Content 下的文件判断。
 * 经 instances.ts 间接引到面板模块，要挂面板解析钩子跑（见 forge-files.test.ts 开头）
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { setCtx } from '../util.ts'
import { forgeAssetExists, forgeReadConfig, forgeSaveConfig, forgeTemplates } from './forge-config-io.ts'

let proj = ''
const root = 'docs/AssetForge'

before(async () => {
  proj = await mkdtemp(path.join(tmpdir(), 'ue-forge-io-'))
  await mkdir(path.join(proj, root, 'umg'), { recursive: true })
  await mkdir(path.join(proj, root, '_templates', 'umg'), { recursive: true })
  await mkdir(path.join(proj, 'Content', 'UI'), { recursive: true })
  await writeFile(path.join(proj, root, 'umg', 'A.json'), '{"kind":"umg-widget"}')
  await writeFile(
    path.join(proj, root, '_templates', 'umg', 'T.json'),
    '{"kind":"umg-widget","template":{"label":"T"}}',
  )
  await writeFile(path.join(proj, 'Content', 'UI', 'WBP_A.uasset'), 'x')
  setCtx({
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})
after(() => rm(proj, { recursive: true, force: true }))

test('读出整份原文和修改时间，保存时文件被别人改过就拒绝', async () => {
  const r = await forgeReadConfig(proj, { root, path: 'umg/A.json' })
  assert.equal(r.text, '{"kind":"umg-widget"}')
  const s = await forgeSaveConfig(proj, {
    root,
    path: 'umg/A.json',
    text: '{"kind":"umg-widget","revision":1}',
    mtime: r.mtime,
  })
  assert.equal(await readFile(path.join(proj, root, 'umg', 'A.json'), 'utf8'), '{"kind":"umg-widget","revision":1}')
  await assert.rejects(
    forgeSaveConfig(proj, { root, path: 'umg/A.json', text: '{}', mtime: '2000-01-01T00:00:00.000Z' }),
    /被改过/,
  )
  assert.ok(s.mtime)
  await assert.rejects(forgeReadConfig(proj, { root, path: '../../x.json' }))
})

test('项目模板只列 _templates 下的 JSON', async () => {
  const r = await forgeTemplates(proj, { root })
  assert.deepEqual(
    r.templates.map((x) => x.path),
    ['umg/T.json'],
  )
})

test('目标资产看 Content 下的 .uasset，/Game 以外不猜', async () => {
  assert.deepEqual(await forgeAssetExists(proj, { asset: '/Game/UI/WBP_A' }), {
    known: true,
    exists: true,
    file: 'Content/UI/WBP_A.uasset',
  })
  assert.equal((await forgeAssetExists(proj, { asset: '/Game/UI/WBP_A.WBP_A' })).exists, true)
  assert.equal((await forgeAssetExists(proj, { asset: '/Game/UI/WBP_B' })).exists, false)
  assert.equal((await forgeAssetExists(proj, { asset: '/MyPlugin/X' })).known, false)
})
