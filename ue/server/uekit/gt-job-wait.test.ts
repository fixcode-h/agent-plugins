// ue_gametest action=job 在工具里等（gt-job-wait.ts）。用法：node --test ue/server/uekit/gt-job-wait.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { waitJob, type JobRec } from './gt-job-wait.ts'

/** 假时钟：sleep 只推进时间，不真等 */
function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

const seq = (list: JobRec[]) => {
  let i = 0
  return async () => list[Math.min(i++, list.length - 1)]
}

test('跑完就返回，不带 hint', async () => {
  const c = clock()
  const r = await waitJob(
    seq([
      { busy: true, failed: 0 },
      { busy: true, failed: 0 },
      { busy: false, failed: 0 },
    ]),
    {
      waitMs: 45000,
      ...c,
    },
  )
  assert.equal(r.busy, false)
  assert.equal(r.stillRunning, undefined)
  assert.equal(c.now(), 2000)
})

test('有步骤失败时马上返回，提示先看结果', async () => {
  const c = clock()
  const r = await waitJob(
    seq([
      { busy: true, failed: 0 },
      { busy: true, failed: 1 },
    ]),
    { waitMs: 45000, ...c },
  )
  assert.equal(r.stillRunning, true)
  assert.match(String(r.hint), /进度有变化/)
})

test('批量里又跑完一个场景时返回', async () => {
  const c = clock()
  const b = (current: number, passed: number) => ({ busy: true, failed: 0, batch: { current, passed, failed: 0 } })
  const r = await waitJob(seq([b(0, 0), b(0, 0), b(1, 1)]), { waitMs: 45000, ...c })
  assert.equal((r.batch as { passed: number }).passed, 1)
})

test('等满还在跑：带 stillRunning，叫再调一次', async () => {
  const c = clock()
  const r = await waitJob(async () => ({ busy: true, failed: 0 }), { waitMs: 3000, ...c })
  assert.equal(r.stillRunning, true)
  assert.match(String(r.hint), /再调一次 job/)
  assert.equal(c.now(), 3000)
})

test('waitMs=0 照旧马上返回，上限 55 秒', async () => {
  const c = clock()
  const r = await waitJob(async () => ({ busy: true }), { waitMs: 0, ...c })
  assert.equal(r.stillRunning, undefined)
  await waitJob(async () => ({ busy: true }), { waitMs: 999999, ...c })
  assert.ok(c.now() <= 56000)
})

test('中途读不到（编辑器卡住）时接着等，恢复后照常返回', async () => {
  const c = clock()
  let i = 0
  const r = await waitJob(
    async () => {
      i++
      if (i === 2 || i === 3) throw new Error('游戏线程卡住了')
      return i < 5 ? { busy: true, failed: 0 } : { busy: false, failed: 0 }
    },
    { waitMs: 45000, ...c },
  )
  assert.equal(r.busy, false)
  assert.equal(r.stuck, undefined)
})

test('一直读不到时等满返回，带 stuck 和不要重启的提示', async () => {
  const c = clock()
  let i = 0
  const r = await waitJob(
    async () => {
      if (i++ === 0) return { busy: true, failed: 0 }
      throw new Error('游戏线程卡住了')
    },
    { waitMs: 5000, ...c },
  )
  assert.equal(r.stillRunning, true)
  assert.equal(r.stuck, '游戏线程卡住了')
  assert.match(String(r.hint), /不要重跑或重启/)
})
