// 心跳探测（busy/alive.ts）。用法：node --test ue/server/busy/alive.test.ts
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:net'
import { test } from 'node:test'
import { probeAlive } from './alive.ts'

const listen = (s: Server) =>
  new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as { port: number }).port)))

test('回了一行：游戏线程卡住，带多久没走一帧', async () => {
  const s = createServer((c) => c.end('{"ok":true,"pid":1,"frame":9,"lastTickAgoMs":4200}\n'))
  const port = await listen(s)
  assert.deepEqual(await probeAlive(port), { state: 'gameThread', tickAgoMs: 4200 })
  s.close()
})

test('连上了却不回：整个进程停住', async () => {
  const held: import('node:net').Socket[] = []
  const s = createServer((c) => void held.push(c))
  const port = await listen(s)
  assert.deepEqual(await probeAlive(port, 200), { state: 'frozen' })
  for (const c of held) c.destroy()
  s.close()
})

test('没有心跳端口或连不上：不知道', async () => {
  assert.equal(await probeAlive(undefined), undefined)
  const s = createServer()
  const port = await listen(s)
  await new Promise((r) => s.close(r))
  assert.equal(await probeAlive(port, 200), undefined)
})
