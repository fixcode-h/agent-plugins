// 等编辑器可用：名片 ready: true 才算就绪，旧 UELink 没有 ready 字段时名片出现就算；fetch failed 当忙不当断开。
// 用法：node --test ue/server/launch/wait-ready.test.ts
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { cardReady, info, type Card } from '../instances.ts'
import type { UeProject } from '../types.ts'
import { setCtx } from '../util.ts'
import { waitEditorReady } from './wait-ready.ts'

setCtx({
  t: (zh: string, vars?: Record<string, string | number>) =>
    zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
} as unknown as PluginServerContext)

const card = (extra: Partial<Card>): Card => ({
  pid: process.pid,
  port: 1,
  token: 'x',
  kind: 'editor',
  engine: '5.4.1',
  bridge: '2.7.0',
  project: '',
  startedAt: new Date().toISOString(),
  ...extra,
})

async function project(c: Card) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ue-ready-'))
  const dir = path.join(root, 'Saved', 'UELink', 'instances')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${c.pid}.json`)
  await writeFile(file, JSON.stringify(c))
  return { p: { id: 'p1', root } as UeProject, file, root }
}

test('没有 ready 字段算就绪，ready: false 不算', () => {
  assert.equal(cardReady({}), true)
  assert.equal(cardReady({ ready: true }), true)
  assert.equal(cardReady({ ready: false }), false)
})

test('名片 ready: true 时马上返回就绪', async () => {
  const { p, root } = await project(card({ ready: true, readyAt: '2026-11-17T00:00:00Z' }))
  const r = await waitEditorReady(p, 5000)
  assert.equal(r.ready, true)
  assert.equal(r.readyAt, '2026-11-17T00:00:00Z')
  await rm(root, { recursive: true, force: true })
})

test('ready: false 时等到变 true', async () => {
  const c = card({ ready: false })
  const { p, file, root } = await project(c)
  setTimeout(() => void writeFile(file, JSON.stringify({ ...c, ready: true })), 1200)
  const r = await waitEditorReady(p, 8000)
  assert.equal(r.ready, true)
  await rm(root, { recursive: true, force: true })
})

test('到点还没就绪返回 loading，不算失败', async () => {
  const { p, root } = await project(card({ ready: false }))
  const r = await waitEditorReady(p, 1000)
  assert.equal(r.ready, false)
  assert.equal(r.state, 'loading')
  await rm(root, { recursive: true, force: true })
})

test('连接被拒（fetch failed）且进程活着时当忙', async () => {
  // 拿一个空闲端口再关掉，保证连上去被拒绝
  const port = await new Promise<number>((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const a = s.address() as { port: number }
      s.close(() => ok(a.port))
    })
  })
  const r = await info(card({ port }))
  assert.equal(r.online, false)
  assert.ok(r.busy)
})
