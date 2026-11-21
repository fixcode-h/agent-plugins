// 项目登记读出来时的一次性搬家（registry.ts load）：选过「项目 .agent-panel/ue」的收藏等搬到文档根；
// Lua 编译设置的团队共用部分搬到文档根、本机只留个人习惯；仓库里拉来的指令本机没确认过不跑。
// 用法：node --test ue/server/lua-build/store.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { getProject, patchProject } from '../registry.ts'
import { setCtx } from '../util.ts'
import { saveLuaBuildConfig } from './config.ts'
import { luaBuildApproved } from './store.ts'

let base = ''
const data = () => path.join(base, 'data')
const regFile = (id: string) => path.join(data(), 'projects', `${id}.json`)
const ueDocs = (id: string) => path.join(base, id, 'Game', 'docs', 'AgentPanel', 'UE')

async function register(id: string, extra: Record<string, unknown>) {
  await mkdir(path.dirname(regFile(id)), { recursive: true })
  await writeFile(
    regFile(id),
    JSON.stringify({ id, name: id, root: path.join(base, id, 'Game'), addedAt: 'x', ...extra }),
  )
}
const stored = async (id: string) => JSON.parse(await readFile(regFile(id), 'utf8'))

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-store-adopt-'))
  setCtx({
    dataDir: data(),
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (m, k: string) => (vars && k in vars ? String(vars[k]) : m)),
    log: { info: () => undefined, warn: () => undefined },
  } as unknown as PluginServerContext)
})

after(() => rm(base, { recursive: true, force: true }))

test('选过项目 .agent-panel/ue 的：那边的收藏、片段、GM 设置复制到文档根，登记里去掉这个设置', async () => {
  const from = path.join(base, 'a', 'Game', '.agent-panel', 'ue')
  await mkdir(from, { recursive: true })
  await writeFile(path.join(from, 'favorites.json'), JSON.stringify({ folders: ['/Game/New'] }))
  await writeFile(path.join(from, 'lua-gm-scan.mjs'), 'export default () => []')
  // 文档根里留着切换前的旧份：以 .agent-panel 那份为准
  await mkdir(ueDocs('a'), { recursive: true })
  await writeFile(path.join(ueDocs('a'), 'favorites.json'), JSON.stringify({ folders: ['/Game/Old'] }))
  await register('a', { favStore: 'project' })
  const p = await getProject('a')
  assert.ok(p && !('favStore' in p))
  assert.deepEqual(JSON.parse(await readFile(path.join(ueDocs('a'), 'favorites.json'), 'utf8')).folders, ['/Game/New'])
  assert.equal(await readFile(path.join(ueDocs('a'), 'lua-gm-scan.mjs'), 'utf8'), 'export default () => []')
  assert.equal('favStore' in (await stored('a')), false)
})

test('Lua 编译设置：本机登记里的共用部分搬到文档根并记成确认过，登记只留个人习惯', async () => {
  await register('b', {
    luaBuild: {
      full: 'build.bat',
      incremental: '',
      cwd: '',
      scriptDir: 'Script',
      errorFormat: '{file}:{line}: {message}',
      autoReload: false,
      editor: 'code -g "{file}:{line}"',
    },
  })
  const p = await getProject('b')
  assert.equal(p?.luaBuild?.full, 'build.bat')
  assert.equal(p?.luaBuild?.editor, 'code -g "{file}:{line}"')
  const shared = JSON.parse(await readFile(path.join(ueDocs('b'), 'lua-build.json'), 'utf8'))
  assert.equal(shared.full, 'build.bat')
  assert.equal(shared.scriptDir, 'Script')
  assert.equal('editor' in shared, false)
  assert.deepEqual((await stored('b')).luaBuild, { autoReload: false, editor: 'code -g "{file}:{line}"' })
  assert.equal(await luaBuildApproved(p!), true)
  // 之后存别的设置也不把共用部分写回本机
  await patchProject('b', { buildCmd: 'x' })
  assert.deepEqual((await stored('b')).luaBuild, { autoReload: false, editor: 'code -g "{file}:{line}"' })
})

test('仓库里拉来的指令本机没确认过不算数；在设置里保存一次就确认了，只改个人习惯不写文档根', async () => {
  await mkdir(ueDocs('c'), { recursive: true })
  const file = path.join(ueDocs('c'), 'lua-build.json')
  await writeFile(file, JSON.stringify({ full: 'evil.bat' }))
  await register('c', {})
  let p = await getProject('c')
  assert.equal(p?.luaBuild?.full, 'evil.bat')
  assert.equal(await luaBuildApproved(p!), false)
  await saveLuaBuildConfig(p!, { editor: 'subl {file}:{line}' })
  // 共用部分没改：文件原样（没写入默认值），但已确认
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { full: 'evil.bat' })
  p = await getProject('c')
  assert.equal(await luaBuildApproved(p!), true)
  assert.equal(p?.luaBuild?.editor, 'subl {file}:{line}')
  // 别人只改了脚本目录：{files} 换成的文件变了，也要重新确认
  await writeFile(file, JSON.stringify({ full: 'evil.bat', scriptDir: 'Other' }))
  p = await getProject('c')
  assert.equal(await luaBuildApproved(p!), false)
  await saveLuaBuildConfig(p!, {})
  // 别人又改了指令：重新要确认
  await writeFile(file, JSON.stringify({ full: 'evil2.bat' }))
  p = await getProject('c')
  assert.equal(await luaBuildApproved(p!), false)
  // 网页上改了共用部分：写进文档根
  await saveLuaBuildConfig(p!, { full: 'good.bat' })
  assert.equal(JSON.parse(await readFile(file, 'utf8')).full, 'good.bat')
  assert.equal(await luaBuildApproved((await getProject('c'))!), true)
})
