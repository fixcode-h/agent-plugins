// 批量（batch/）：UELink 2.14 的批量作业怎么调、汇总怎么整理、整批撤回怎么拼。
// 用法（在仓库根）：node scripts/test.mjs ue server/batch/batch.test.ts
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import type { Card } from '../instances.ts'
import { runAsJob } from '../long-ops.ts'
import { retryItems } from './retry.ts'
import { changes, formatBatch } from './run.ts'
import { batchUndo, itemPaths, type ReportStep } from './undo.ts'

/** 假桥接：batchOps 里登记的操作收到 paths 时回作业号，job.wait 回批量汇总 */
function fakeBridge(batchOps: string[]) {
  const calls: { op: string; args: Record<string, unknown> }[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const send = (o: unknown) => res.end(JSON.stringify(o))
      if (req.url === '/info') return send({ ok: true, ops: ['bp.edit', 'job.start', 'job.wait'], batchOps })
      const { op, args } = JSON.parse(body) as { op: string; args: Record<string, unknown> }
      calls.push({ op, args })
      if (op === 'bp.edit') return send({ ok: true, job: 'uelink-7', batch: true, items: 2, status: 'queued' })
      if (op === 'job.wait')
        return send({
          ok: true,
          id: args.id,
          status: 'failed',
          total: 4,
          batch: {
            op: 'bp.edit',
            items: 2,
            ok: 1,
            failed: 1,
            list: [{ path: '/Game/B', state: 'failed', error: 'x' }],
          },
        })
      send({ ok: false, error: `不支持 ${op}` })
    })
  })
  return new Promise<{ card: Card; calls: typeof calls; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      const card = {
        pid: port,
        port,
        token: 't',
        kind: 'editor',
        engine: '5.4',
        bridge: '2.14.0',
        project: '',
        startedAt: '',
      }
      resolve({ card, calls, close: () => server.close() })
    }),
  )
}

const opened: (() => void)[] = []
after(() => opened.forEach((c) => c()))

test('批量：操作本身带 paths 调，拿到作业号后等汇总，失败的资源不按报错抛', async () => {
  const b = await fakeBridge(['bp.edit'])
  opened.push(b.close)
  const r = await runAsJob(b.card, 'bp.edit', { paths: ['/Game/A', '/Game/B'], ops: [] }, 5000)
  assert.equal(r.done, true)
  assert.equal((r.res.batch as { failed: number }).failed, 1)
  assert.deepEqual(
    b.calls.map((c) => c.op),
    ['bp.edit', 'job.wait'],
  )
  assert.deepEqual(b.calls[0].args.paths, ['/Game/A', '/Game/B'])
})

test('批量：UELink 不支持时报错说明要升级', async () => {
  const b = await fakeBridge([])
  opened.push(b.close)
  await assert.rejects(runAsJob(b.card, 'bp.edit', { paths: ['/Game/A'] }, 5000), /UELink 2\.14/)
})

async function report(steps: ReportStep[]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ue-batch-'))
  const file = path.join(dir, 'uelink-7.json')
  await writeFile(file, JSON.stringify({ steps }), 'utf8')
  return file
}

test('整批撤回：改成功且没被回滚的按倒序交给 asset.undo', async () => {
  const file = await report([
    { op: 'bp.edit', state: 'ok', item: 0, phase: 'apply', args: { path: '/Game/A' }, result: { tx: 'a' } },
    { op: 'bp.edit', state: 'ok', item: 1, phase: 'apply', args: { path: '/Game/B' }, result: { tx: 'b' } },
    { op: 'bp.edit', state: 'ok', item: 2, phase: 'apply', args: { path: '/Game/C' }, result: { tx: 'c' } },
    { op: 'asset.undo', state: 'ok', item: 1, phase: 'undo', args: { path: '/Game/B' } },
  ])
  const u = (await batchUndo('bp.edit', { report: file })) as { undo: { op: string; args: { items: unknown[] } } }
  assert.equal(u.undo.op, 'asset.undo')
  assert.deepEqual(u.undo.args.items, [
    { path: '/Game/C', tx: 'c' },
    { path: '/Game/A', tx: 'a' },
  ])
})

test('整批撤回：set 用 prev 设回去', async () => {
  const file = await report([
    { op: 'set', state: 'ok', item: 0, phase: 'apply', args: { path: '/Game/A', prop: 'Hp' }, result: { prev: 10 } },
  ])
  const u = (await batchUndo('set', { report: file })) as { undo: { op: string; args: { items: unknown[] } } }
  assert.deepEqual(u.undo.args.items, [{ path: '/Game/A', prop: 'Hp', value: 10 }])
})

test('汇总：每个资源一行，读的结果不大时直接附上', async () => {
  const file = await report([
    {
      op: 'bp.outline',
      state: 'ok',
      item: 0,
      phase: 'run',
      args: { path: '/Game/A' },
      result: { parent: 'Actor', variables: [1, 2] },
    },
  ])
  const o = await formatBatch(
    {
      id: 'uelink-7',
      status: 'done',
      report: file,
      batch: { items: 1, ok: 1, list: [{ path: '/Game/A', state: 'ok' }] },
    },
    false,
  )
  assert.equal(o.ok, 1)
  assert.match((o.lines as string[])[0], /\/Game\/A {2}ok {2}.*variables=2/)
  assert.deepEqual(Object.keys(o.results as object), ['/Game/A'])
})

test('参数里的资源路径：paths 或 items', () => {
  assert.deepEqual(itemPaths({ paths: ['/Game/A'] }), ['/Game/A'])
  assert.deepEqual(itemPaths({ items: [{ path: '/Game/B', to: '/Game/C' }] }), ['/Game/B'])
})

test('改前改后：从结果里取 prev → value，跳过的写当前值', () => {
  assert.deepEqual(changes({ results: [{ prop: 'Speed', prev: 1, value: 2 }] }), ['Speed: 1 → 2'])
  assert.deepEqual(changes({ rows: [{ row: 'R1', prev: 'a', skipped: true }] }), ['R1: 跳过（当前 a）'])
  assert.deepEqual(changes({ ok: true }), [])
})

test('重做失败的：只取没成功的资源，用真改那步的参数', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ue-retry-'))
  const dir = path.join(root, 'Saved', 'UELink', 'jobs')
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'uelink-9.json'),
    JSON.stringify({
      steps: [
        { op: 'bp.edit', item: 0, phase: 'apply', state: 'ok', args: { path: '/Game/A', ops: [1] } },
        { op: 'bp.edit', item: 1, phase: 'apply', state: 'failed', args: { path: '/Game/B', ops: [1] } },
      ],
      batch: {
        list: [
          { path: '/Game/B', item: 1, state: 'failed' },
          { path: '/Game/A', item: 0, state: 'ok' },
        ],
      },
    }),
  )
  const r = await retryItems(root, 'uelink-9')
  assert.deepEqual(
    r.items.map((i: Record<string, unknown>) => i.path),
    ['/Game/B'],
  )
})
