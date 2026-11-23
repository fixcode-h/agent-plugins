// 插件源码替换（install-files.ts）：换进去的要完整，失败时项目里的插件恢复原样，不留删了一半的 Source。
// 用法：node --test ue/server/install-files.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../sdk/server.ts'
import { missingModules, swapPluginFiles } from './install-files.ts'
import type { Job } from './types.ts'
import { setCtx } from './util.ts'

let base = ''
const job = () => ({ id: 'j', kind: 'install', title: '', status: 'running', log: [], startedAt: 0 }) as unknown as Job

const touch = async (f: string, body = '') => {
  await mkdir(path.dirname(f), { recursive: true })
  await writeFile(f, body)
}

/** 造一份 UELink：两个模块，each 一个 Build.cs；skip 里的模块不写 Build.cs（模拟删到一半） */
async function plugin(dir: string, version: string, skip: string[] = []) {
  await touch(
    path.join(dir, 'UELink.uplugin'),
    JSON.stringify({ VersionName: version, Modules: [{ Name: 'UELinkCore' }, { Name: 'UELinkEditor' }] }),
  )
  for (const m of ['UELinkCore', 'UELinkEditor']) {
    await touch(path.join(dir, 'Source', m, 'Private', `${m}.cpp`), version)
    if (!skip.includes(m)) await touch(path.join(dir, 'Source', m, `${m}.Build.cs`), version)
  }
  await touch(path.join(dir, 'Config', 'FilterPlugin.ini'), version)
}

before(async () => {
  setCtx({
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
  base = await mkdtemp(path.join(tmpdir(), 'ue-install-'))
})
after(() => rm(base, { recursive: true, force: true }))

test('missingModules：列出 .uplugin 里有、Build.cs 不在的模块', async () => {
  const dir = path.join(base, 'm', 'UELink')
  await plugin(dir, '1.0.0', ['UELinkCore'])
  assert.deepEqual(await missingModules(dir, 'UELink'), ['UELinkCore'])
  await touch(path.join(dir, 'Source', 'UELinkCore', 'UELinkCore.Build.cs'))
  assert.deepEqual(await missingModules(dir, 'UELink'), [])
  assert.deepEqual(await missingModules(path.join(base, 'none'), 'UELink'), [])
})

test('换新版：旧源码整个换掉，Binaries 和用户自己放的文件留着，旧文件不留在项目里', async () => {
  const root = path.join(base, 'ok')
  const dest = path.join(root, 'Plugins', 'UELink')
  await plugin(dest, '1.0.0')
  await touch(path.join(dest, 'Source', 'UELinkCore', 'Private', 'Removed.cpp'), 'old')
  await touch(path.join(dest, 'Binaries', 'Win64', 'UnrealEditor-UELinkCore.dll'), 'dll')
  await touch(path.join(dest, 'Notes.txt'), 'mine')
  const src = path.join(base, 'ok-src', 'UELink')
  await plugin(src, '2.0.0')

  await swapPluginFiles(job(), src, dest, 'UELink', root)
  assert.equal(await readFile(path.join(dest, 'Source', 'UELinkCore', 'UELinkCore.Build.cs'), 'utf8'), '2.0.0')
  await assert.rejects(readFile(path.join(dest, 'Source', 'UELinkCore', 'Private', 'Removed.cpp')))
  assert.equal(await readFile(path.join(dest, 'Binaries', 'Win64', 'UnrealEditor-UELinkCore.dll'), 'utf8'), 'dll')
  assert.equal(await readFile(path.join(dest, 'Notes.txt'), 'utf8'), 'mine')
  assert.deepEqual(await readdir(path.join(root, 'Intermediate', 'AgentPanel')), [])
})

test('修复：缺 Build.cs 的旧目录也能换成完整的', async () => {
  const root = path.join(base, 'fix')
  const dest = path.join(root, 'Plugins', 'UELink')
  await plugin(dest, '2.0.0', ['UELinkCore'])
  const src = path.join(base, 'fix-src', 'UELink')
  await plugin(src, '2.0.0')
  await swapPluginFiles(job(), src, dest, 'UELink', root)
  assert.deepEqual(await missingModules(dest, 'UELink'), [])
})

test('新包不全：报错，项目里的插件恢复成原来的文件', async () => {
  const root = path.join(base, 'bad')
  const dest = path.join(root, 'Plugins', 'UELink')
  await plugin(dest, '1.0.0')
  const src = path.join(base, 'bad-src', 'UELink')
  await plugin(src, '2.0.0', ['UELinkEditor'])

  await assert.rejects(swapPluginFiles(job(), src, dest, 'UELink', root), /恢复成原来的文件.*UELinkEditor/)
  assert.equal(await readFile(path.join(dest, 'Source', 'UELinkCore', 'UELinkCore.Build.cs'), 'utf8'), '1.0.0')
  assert.equal(await readFile(path.join(dest, 'Source', 'UELinkEditor', 'UELinkEditor.Build.cs'), 'utf8'), '1.0.0')
  assert.match(await readFile(path.join(dest, 'UELink.uplugin'), 'utf8'), /1\.0\.0/)
  assert.deepEqual(await missingModules(dest, 'UELink'), [])
})
