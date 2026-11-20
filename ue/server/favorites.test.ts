// 资源页收藏的文件夹：存放位置（文档根 / .agent-panel）、旧数据搬家、按动作改、换位置带过去。
// 用法：node --test ue/server/favorites.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { before, test } from 'node:test'
import type { PluginServerContext } from '../../sdk/server.ts'
import { docsRoot, setDocsRootForTest } from './doc-root.ts'
import { editFavs, favFile, moveFavs, readFavs } from './favorites.ts'
import { patchLocal, readLocal } from './store.ts'
import type { UeProject } from './types.ts'
import { setCtx } from './util.ts'

let base = ''
const proj = (id: string, favStore: UeProject['favStore'] = 'docs') =>
  ({ id, root: path.join(base, id, 'Game'), favStore }) as UeProject

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-favs-'))
  setCtx({
    dataDir: path.join(base, 'data'),
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
  } as unknown as PluginServerContext)
})

test('文档根：面板没给时外层有 ProjectDoc/docs 用它，否则项目里的 docs', async () => {
  const p = proj('a')
  assert.equal(docsRoot(p), path.join(p.root, 'docs'))
  await mkdir(path.join(base, 'a', 'ProjectDoc', 'docs'), { recursive: true })
  assert.equal(docsRoot(p), path.join(base, 'a', 'ProjectDoc', 'docs'))
  assert.equal(favFile(p), path.join(base, 'a', 'ProjectDoc', 'docs', 'AgentPanel', 'UE', 'favorites.json'))
  assert.equal(favFile(proj('a', 'project')), path.join(p.root, '.agent-panel', 'ue', 'favorites.json'))
})

test('第一次读把插件数据目录里的旧收藏搬进项目', async () => {
  const p = proj('b')
  await patchLocal('b', { folders: ['/Game/Maps', '/Game/UI'] })
  assert.deepEqual((await readFavs(p)).folders, ['/Game/Maps', '/Game/UI'])
  assert.deepEqual((await readLocal('b')).folders, [])
  const saved = JSON.parse(await readFile(favFile(p), 'utf8'))
  assert.deepEqual(saved.folders, ['/Game/Maps', '/Game/UI'])
})

test('加、删、挪位置；重复和不是包路径的丢掉', async () => {
  const p = proj('c')
  await editFavs(p, { action: 'add', path: '/Game/A' })
  await editFavs(p, { action: 'add', path: '/Game/B' })
  await editFavs(p, { action: 'add', path: '/Game/A' })
  await editFavs(p, { action: 'add', path: 'bad' })
  assert.deepEqual((await readFavs(p)).folders, ['/Game/B', '/Game/A'])
  await editFavs(p, { action: 'add', path: '/Game/C' })
  assert.deepEqual((await editFavs(p, { action: 'move', path: '/Game/C', to: 0 })).folders, [
    '/Game/C',
    '/Game/B',
    '/Game/A',
  ])
  assert.deepEqual((await editFavs(p, { action: 'remove', path: '/Game/B' })).folders, ['/Game/C', '/Game/A'])
  await assert.rejects(editFavs(p, { action: 'zap', path: '/Game/A' }))
})

test('换存放位置：现有的收藏带过去，和新位置已有的合并', async () => {
  const docs = proj('d')
  const local = proj('d', 'project')
  await editFavs(docs, { action: 'add', path: '/Game/X' })
  await editFavs(local, { action: 'add', path: '/Game/Y' })
  await moveFavs(docs, local)
  assert.deepEqual((await readFavs(local)).folders, ['/Game/Y', '/Game/X'])
})

test('面板给了文档根就用它；旧位置的收藏照样读得到，改了写进新位置', async () => {
  const p = proj('d')
  const old = path.join(p.root, 'docs', 'AgentPanel', 'UE')
  await mkdir(old, { recursive: true })
  await writeFile(path.join(old, 'favorites.json'), JSON.stringify({ folders: ['/Game/Old'] }))
  const shared = path.join(base, 'shared', 'ProjectDoc', 'docs')
  setDocsRootForTest('d', shared)
  assert.equal(favFile(p), path.join(shared, 'AgentPanel', 'UE', 'favorites.json'))
  assert.deepEqual((await readFavs(p)).folders, ['/Game/Old'])
  await editFavs(p, { action: 'add', path: '/Game/New' })
  const saved = JSON.parse(await readFile(favFile(p), 'utf8'))
  assert.deepEqual(saved.folders, ['/Game/Old', '/Game/New'])
  setDocsRootForTest('d', undefined)
})
