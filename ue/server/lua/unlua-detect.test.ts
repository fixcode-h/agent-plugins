// UnLua 认法（lua/unlua-detect.ts）：不靠固定目录，子目录、改名、引擎里、Build.cs 依赖都要认得出。
// 用法：node --test ue/server/lua/unlua-detect.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { detectUnLua } from './unlua-detect.ts'

const dirs: string[] = []
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))))

async function project(files: Record<string, string>, uproject: object = {}) {
  const base = await mkdtemp(path.join(tmpdir(), 'ue-unlua-'))
  dirs.push(base)
  const root = path.join(base, 'Game')
  const engine = path.join(base, 'UE')
  for (const [f, text] of Object.entries(files)) {
    const full = path.join(base, f)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, text)
  }
  await mkdir(root, { recursive: true })
  const up = path.join(root, 'Game.uproject')
  await writeFile(up, JSON.stringify(uproject))
  return { root, uproject: up, engine: { dir: engine } as never, engineDir: '' }
}

const BUILD = 'public class UnLua : ModuleRules {}'

test('没有 UnLua', async () => {
  const p = await project({ 'Game/Plugins/Other/Other.uplugin': '{}', 'Game/Source/Game/Game.Build.cs': '"Core"' })
  assert.equal((await detectUnLua(p)).found, false)
})

test('Plugins 下深几层的 UnLua.uplugin', async () => {
  const p = await project({ 'Game/Plugins/Script/Third/UnLua/UnLua.uplugin': '{}' })
  assert.deepEqual([(await detectUnLua(p)).found, (await detectUnLua(p)).via], [true, 'plugin'])
})

test('插件改了名，但带 UnLua 模块', async () => {
  const p = await project({
    'Game/Plugins/MyLua/MyLua.uplugin': '{}',
    'Game/Plugins/MyLua/Source/UnLua/UnLua.Build.cs': BUILD,
  })
  assert.equal((await detectUnLua(p)).via, 'plugin')
})

test('.uproject 里启用了', async () => {
  const p = await project({}, { Plugins: [{ Name: 'UnLua', Enabled: true }] })
  assert.equal((await detectUnLua(p)).via, 'uproject')
})

test('.uproject 里关掉了就不算', async () => {
  const p = await project(
    { 'Game/Plugins/UnLua/UnLua.uplugin': '{}' },
    { Plugins: [{ Name: 'UnLua', Enabled: false }] },
  )
  assert.deepEqual(await detectUnLua(p).then((r) => [r.found, r.via]), [false, 'disabled'])
})

test('项目代码依赖 UnLua 模块', async () => {
  const p = await project({
    'Game/Source/Game/Game.Build.cs': 'PublicDependencyModuleNames.AddRange(new[] { "Core", "UnLua" });',
  })
  assert.equal((await detectUnLua(p)).via, 'buildcs')
})

test('引擎里的 UnLua：项目启用了才算', async () => {
  const files = {
    'UE/Engine/Plugins/Script/LuaKit/LuaKit.uplugin': '{}',
    'UE/Engine/Plugins/Script/LuaKit/Source/UnLua/UnLua.Build.cs': BUILD,
  }
  assert.equal((await detectUnLua(await project(files))).found, false)
  const on = await project(files, { Plugins: [{ Name: 'LuaKit', Enabled: true }] })
  assert.equal((await detectUnLua(on)).via, 'engine')
})
