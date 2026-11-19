// ue_forge describe section：只读 / 只写一段，段 include 读写落到片段文件。
// 用法：node --test ue/server/uekit/forge-section.test.ts
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { forgeSection } from './forge-section.ts'

async function setup() {
  const proj = await mkdtemp(path.join(tmpdir(), 'ue-forge-section-'))
  const root = path.join(proj, 'docs', 'AssetForge')
  const put = async (rel: string, text: string) => {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true })
    await writeFile(path.join(root, rel), text)
  }
  await put(
    'umg/W.json',
    '{\n  "kind": "umg-widget",\n  "root": { "class": "Overlay", "name": "Root" },\n  "animations": { "include": "W.parts/anim.json" },\n  "styles": {}\n}\n',
  )
  await put('umg/W.parts/anim.json', '{\n  "fragment": "animations",\n  "animations": []\n}\n')
  return { proj, root }
}

test('读一段：原文、行号、段列表', async () => {
  const { proj } = await setup()
  const r = (await forgeSection(proj, { config: 'umg/W.json', section: 'root' })) as Record<string, unknown>
  assert.equal(r.text, '"root": { "class": "Overlay", "name": "Root" }')
  assert.deepEqual(r.lines, [3, 3])
  assert.ok(String((r.sections as string[]).join()).includes('include W.parts/anim.json'))
})

test('段 include：读回片段内容，写回落到片段文件，主文件不动', async () => {
  const { proj, root } = await setup()
  const r = (await forgeSection(proj, { config: 'umg/W.json', section: 'animations' })) as Record<string, unknown>
  assert.equal(r.fragment, 'umg/W.parts/anim.json')
  assert.equal(r.text, '"animations": []')
  const main = await stat(path.join(root, 'umg/W.json'))
  const w = await forgeSection(proj, {
    config: 'umg/W.json',
    section: 'animations',
    text: '"animations": [{ "name": "In", "tracks": [] }]',
  })
  assert.equal((w as { written: boolean }).written, true)
  assert.equal(
    await readFile(path.join(root, 'umg/W.parts/anim.json'), 'utf8'),
    '{\n  "fragment": "animations",\n  "animations": [{ "name": "In", "tracks": [] }]\n}\n',
  )
  assert.equal((await stat(path.join(root, 'umg/W.json'))).mtimeMs, main.mtimeMs)
})

test('写一段：只换这段，顶层按段排好；写错的段不落盘', async () => {
  const { proj, root } = await setup()
  await forgeSection(proj, { config: 'umg/W.json', section: 'root', text: '"root": { "class": "Canvas" }' })
  const text = await readFile(path.join(root, 'umg/W.json'), 'utf8')
  assert.equal(
    text,
    '{\n  "kind": "umg-widget",\n  "styles": {},\n  "root": { "class": "Canvas" },\n  "animations": { "include": "W.parts/anim.json" }\n}\n',
  )
  await assert.rejects(
    forgeSection(proj, { config: 'umg/W.json', section: 'root', text: '"kind": "x"' }),
    /不能有字段 kind/,
  )
  await assert.rejects(forgeSection(proj, { config: '../x.json', section: 'root' }), /配置根/)
})
