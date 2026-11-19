/** AssetForge 配置存盘推送：盯右栏选中的配置，改了推 forge.file，改名替换式保存也认得，出了配置根拒绝 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { setCtx } from '../util.ts'
import { forgeWatch, stopForgeWatches } from './forge-watch.ts'

let base = ''
const pushed: { data: Record<string, unknown>; to: unknown }[] = []
let closeCb: ((conn: string) => void) | undefined

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'ue-forge-watch-'))
  await mkdir(path.join(base, 'Game', 'docs', 'AssetForge', 'umg'), { recursive: true })
  await writeFile(path.join(base, 'Game', 'docs', 'AssetForge', 'umg', 'A.json'), '{}')
  setCtx({
    t: (zh: string, vars?: Record<string, string | number>) =>
      zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
    pages: {
      open: (conn: string) => conn.startsWith('c'),
      onClose: (fn: (conn: string) => void) => {
        closeCb = fn
        return () => undefined
      },
    },
  } as unknown as PluginServerContext)
})

after(async () => {
  stopForgeWatches()
  await rm(base, { recursive: true, force: true })
})

/** 等到推了 n 条（fs.watch 和防抖都是异步的），最多等 3 秒 */
async function waitPushed(n: number) {
  for (let i = 0; i < 60 && pushed.length < n; i++) await new Promise((r) => setTimeout(r, 50))
}

const root = path.join('docs', 'AssetForge')
const projectRoot = () => path.join(base, 'Game')
const push = (data: Record<string, unknown>, to: string) => void pushed.push({ data, to })
const watchIt = (project: string, b: Record<string, unknown>) =>
  forgeWatch(project, path.join(projectRoot(), root), b, push)

test('存盘推给登记的页面，改名替换式保存也算', async () => {
  const r = await watchIt('p1', { conn: 'c1', path: 'umg/A.json' })
  assert.equal(r.watching, true)
  const file = path.join(projectRoot(), root, 'umg', 'A.json')
  await new Promise((res) => setTimeout(res, 20))
  await writeFile(file, '{"revision":1}')
  await waitPushed(1)
  assert.equal(pushed.length, 1)
  assert.deepEqual(
    { project: pushed[0].data.project, event: pushed[0].data.event, path: pushed[0].data.path, to: pushed[0].to },
    { project: 'p1', event: 'forge.file', path: 'umg/A.json', to: 'c1' },
  )
  // 编辑器先写临时文件再改名替换
  await new Promise((res) => setTimeout(res, 20))
  const tmp = path.join(projectRoot(), root, 'umg', 'A.json.tmp')
  await writeFile(tmp, '{"revision":2}')
  await rename(tmp, file)
  await waitPushed(2)
  assert.equal(pushed.length, 2)
})

test('取消选中或连接断了就不再推', async () => {
  await watchIt('p1', { conn: 'c2', path: 'umg/A.json' })
  // 换项目时取消旧项目的登记，不影响别的项目
  await watchIt('p2', { conn: 'c2', path: '' })
  closeCb?.('c1')
  const n = pushed.length
  await new Promise((res) => setTimeout(res, 20))
  await writeFile(path.join(projectRoot(), root, 'umg', 'A.json'), '{"revision":9}')
  await waitPushed(n + 1)
  assert.deepEqual(
    pushed.slice(n).map((x) => x.to),
    ['c2'],
  )
  await watchIt('p1', { conn: 'c2', path: '' })
  const before = pushed.length
  await writeFile(path.join(projectRoot(), root, 'umg', 'A.json'), '{"revision":3}')
  await new Promise((res) => setTimeout(res, 600))
  assert.equal(pushed.length, before)
})

test('只认配置根里的 .json', async () => {
  await assert.rejects(watchIt('p1', { conn: 'c3', path: '../../x.json' }))
  await assert.rejects(watchIt('p1', { conn: 'c3', path: 'umg/A.txt' }))
  assert.deepEqual(await watchIt('p1', { conn: 'x', path: 'umg/A.json' }), { watching: false })
})

test('include 的片段文件（extra）存盘也推主配置的路径，出了配置根的片段不盯', async () => {
  const dir = path.join(projectRoot(), root, 'umg', 'A.parts')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'anim.json'), '{}')
  const r = await watchIt('p3', { conn: 'c3', path: 'umg/A.json', extra: ['umg/A.parts/anim.json', '../../x.json'] })
  assert.equal(r.watching, true)
  const n = pushed.length
  await new Promise((res) => setTimeout(res, 20))
  await writeFile(path.join(dir, 'anim.json'), '{"fragment":"animations"}')
  await waitPushed(n + 1)
  assert.equal(pushed.length, n + 1)
  assert.equal(pushed[n].data.path, 'umg/A.json')
  assert.equal(pushed[n].to, 'c3')
})
