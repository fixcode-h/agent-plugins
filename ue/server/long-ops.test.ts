// 长操作变作业（long-ops.ts）：新桥接走 job.start / job.wait、旧桥接直接调、没做完回作业号再接着等、一步失败按报错抛。
// 用法（在 ue/ 下；它间接引用面板模块，要先 npm run panel）：
// AGENT_PLUGIN_PANEL=../.panel AGENT_PLUGIN_DIR=. node --import ../scripts/lib/panel-register.mjs --test server/long-ops.test.ts
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, test } from 'node:test'
import type { Card } from './instances.ts'
import { keepJob, resumeJob, runAsJob } from './long-ops.ts'

/** 假桥接：jobs=true 时支持作业；finishAfter 是第几次 job.wait 才做完 */
function fakeBridge(jobs: boolean, finishAfter = 1, fail = false) {
  const calls: string[] = []
  let waits = 0
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const send = (o: unknown) => res.end(JSON.stringify(o))
      if (req.url === '/info')
        return send({ ok: true, ops: jobs ? ['bp.compile', 'job.start', 'job.wait'] : ['bp.compile'] })
      const { op, args } = JSON.parse(body) as { op: string; args: Record<string, unknown> }
      calls.push(op)
      if (op === 'bp.compile') return send({ ok: true, compile: { status: 'ok' }, direct: true })
      if (op === 'job.start') return send({ ok: true, job: 'uelink-1', status: 'queued', total: 1 })
      if (op === 'job.wait') {
        waits++
        if (waits < finishAfter)
          return send({ ok: true, id: args.id, status: 'running', total: 1, finished: 0, current: 'bp.compile' })
        if (fail) return send({ ok: true, id: args.id, status: 'failed', total: 1, error: '找不到蓝图' })
        return send({
          ok: true,
          id: args.id,
          status: 'done',
          total: 1,
          result: { compile: { status: 'ok' }, viaJob: true },
        })
      }
      send({ ok: false, error: `这个进程不支持 ${op}` })
    })
  })
  return new Promise<{ card: Card; calls: string[]; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const card = {
        pid: port,
        port,
        token: 't',
        kind: 'editor',
        engine: '5.4',
        bridge: '2.13.0',
        project: '',
        startedAt: '',
      }
      resolve({ card, calls, close: () => server.close() })
    }),
  )
}

const opened: (() => void)[] = []
after(() => opened.forEach((c) => c()))

test('旧桥接没有 job.start：直接调', async () => {
  const b = await fakeBridge(false)
  opened.push(b.close)
  const r = await runAsJob(b.card, 'bp.compile', { path: '/Game/A' }, 5000)
  assert.equal(r.done, true)
  assert.equal(r.res.direct, true)
  assert.deepEqual(b.calls, ['bp.compile'])
})

test('新桥接：作业做完拆出这一步的结果', async () => {
  const b = await fakeBridge(true)
  opened.push(b.close)
  const r = await runAsJob(b.card, 'bp.compile', { path: '/Game/A' }, 5000)
  assert.equal(r.done, true)
  assert.equal(r.res.viaJob, true)
  assert.deepEqual(b.calls, ['job.start', 'job.wait'])
})

test('没做完回作业号，带 job 接着等时按原操作收尾', async () => {
  const b = await fakeBridge(true, 2)
  opened.push(b.close)
  const r = await runAsJob(b.card, 'bp.compile', {}, 5000)
  assert.equal(r.done, false)
  assert.equal(r.res.job, 'uelink-1')
  let finished = false
  keepJob('p', 'uelink-1', {
    card: b.card,
    finish: async (x) => ((finished = true), { ...x, history: 'h1' }),
    fail: async () => {},
  })
  const res = await resumeJob('p', 'uelink-1')
  assert.equal(finished, true)
  assert.equal(res.history, 'h1')
  await assert.rejects(resumeJob('p', 'uelink-1'), /没有在等的作业/)
})

test('一步失败：按报错抛', async () => {
  const b = await fakeBridge(true, 1, true)
  opened.push(b.close)
  await assert.rejects(runAsJob(b.card, 'bp.compile', {}, 5000), /找不到蓝图/)
})
