// AssetForge 页的快速清单：配置根和 JSON 直接从磁盘读（forge-disk.ts）。
// 用法：node --test ue/server/uekit/forge-disk.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { forgeConfigRoot, forgeFromDisk, normalizeAsset, stripComments } from './forge-disk.ts'

const put = async (file: string, text: string) => {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, text)
}

test('配置根：没设置时跟文档根，设置了按设置', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'ue-forge-disk-'))
  const proj = path.join(base, 'Game')
  await mkdir(proj, { recursive: true })
  assert.equal(await forgeConfigRoot(proj), path.join(proj, 'docs', 'AssetForge'))
  await mkdir(path.join(base, 'ProjectDoc', 'docs'), { recursive: true })
  assert.equal(await forgeConfigRoot(proj), path.join(base, 'ProjectDoc', 'docs', 'AssetForge'))
  await put(
    path.join(proj, 'Config', 'DefaultEditor.ini'),
    '[/Script/AssetForge.AssetForgeSettings]\nConfigRoot=(Path="../Cfg/Forge")\n',
  )
  assert.equal(await forgeConfigRoot(proj), path.join(base, 'Cfg', 'Forge'))
})

test('清单：只列配置根下的 json，跳过 _ 和 . 开头的、片段文件，坏 JSON 标解析失败，状态留空等 UE', async () => {
  const proj = await mkdtemp(path.join(tmpdir(), 'ue-forge-disk-'))
  const root = path.join(proj, 'docs', 'AssetForge')
  await put(
    path.join(root, 'umg', 'UI', 'WBP_HUD.json'),
    '// 注释\n{ "kind": "umg", "revision": 3, "asset": "/Game/UI/WBP_HUD.WBP_HUD", "root": { "name": "a//b" } }',
  )
  await put(path.join(root, 'data', 'Bad.json'), '{ "kind": ')
  await put(path.join(root, '_templates', 'umg', 'T.json'), '{}')
  await put(path.join(root, 'umg', '_schema.json'), '{}')
  await put(path.join(root, 'umg', 'readme.txt'), 'x')
  // include 的片段文件、.schema/ 下的 JSON Schema 都不是资源（设计稿 4.3.4、4.3.5）
  await put(path.join(root, 'umg', 'UI', 'WBP_HUD.parts', 'side.json'), '{ "fragment": "node", "node": {} }')
  await put(path.join(root, '.schema', 'umg-widget.schema.json'), '{ "type": "object" }')
  const r = (await forgeFromDisk(proj, 'forge.entries', { limit: 100 })) as unknown as {
    entries: { key: string; state: string; kind?: string; asset?: string; revision?: number; name: string }[]
    total: number
    disk: boolean
  }
  assert.equal(r.disk, true)
  assert.equal(r.total, 2)
  assert.deepEqual(
    r.entries.map((e) => e.key),
    ['data/Bad.json', 'umg/UI/WBP_HUD.json'],
  )
  const hud = r.entries[1]
  assert.equal(hud.state, '')
  assert.equal(hud.kind, 'umg')
  assert.equal(hud.asset, '/Game/UI/WBP_HUD')
  assert.equal(hud.revision, 3)
  assert.equal(hud.name, 'WBP_HUD')
  assert.equal(r.entries[0].state, 'parse-error')
  const h = (await forgeFromDisk(proj, 'forge.health', {})) as { configRoot: string; configRootExists: boolean }
  assert.equal(h.configRootExists, true)
  assert.equal(h.configRoot, root.replace(/\\/g, '/'))
})

test('注释和资产路径的写法和 UE 一致', () => {
  assert.equal(stripComments('{"a":"x//y", /* b */ "c":1} // d'), '{"a":"x//y",  "c":1} ')
  assert.equal(normalizeAsset("/Script/Engine.Blueprint'/Game/A/B.B'"), '/Game/A/B')
  assert.equal(normalizeAsset('/Game/A/B.B_C'), '/Game/A/B')
  assert.equal(normalizeAsset(' /Game/A/B '), '/Game/A/B')
})
