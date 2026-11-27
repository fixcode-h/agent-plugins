// 对话里 ue_gametest 卡片的纯数据。用法：node --test ue/web/gt-tool-card/state.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRunSub, runSub } from './link.ts'
import { liveStepLine, runPhase, runResult, runTarget, tallyOf } from './state.ts'

test('跑的是什么：脚本只显示文件名（去掉 .json），标签、多个脚本、临时步骤各有写法', () => {
  assert.deepEqual(runTarget({ scenario: 'openspec/x/R1-碰杯.json' }), {
    scenario: 'openspec/x/R1-碰杯.json',
    label: 'R1-碰杯',
  })
  assert.equal(runTarget({ tag: 'regression' }).label, 'tag=regression')
  assert.equal(runTarget({ scenarios: ['a', 'b', 'c'] }).label, 'a +2')
  assert.equal(runTarget({ steps: [{}, {}] }).label, 'steps×2')
})

test('工具返回：取 runId 和计划步数，报错取 error，不是 JSON 当没拿到', () => {
  assert.deepEqual(runResult('{"runId":"r1","steps":5}'), { runId: 'r1', planned: 5 })
  assert.deepEqual(runResult('{"error":"编辑器没开"}'), { error: '编辑器没开' })
  assert.deepEqual(runResult('超时'), {})
})

test('状态：调用中、跑着、通过、失败；别的运行的作业不算这次的', () => {
  const job = (o: object) => ({ runId: 'r1', status: 'done', busy: false, total: 3, failed: 0, steps: [], ...o })
  assert.equal(runPhase({ calling: true, failed: false }), 'starting')
  assert.equal(runPhase({ calling: false, failed: false, runId: 'r1', job: job({ busy: true }) }), 'running')
  assert.equal(runPhase({ calling: false, failed: false, runId: 'r1', job: job({}) }), 'passed')
  assert.equal(runPhase({ calling: false, failed: false, runId: 'r1', job: job({ failed: 1 }) }), 'failed')
  assert.equal(runPhase({ calling: false, failed: false, runId: 'r1', job: job({ runId: 'r0' }) }), 'unknown')
  assert.equal(runPhase({ calling: false, failed: false, error: 'x' }), 'error')
  // 作业已经是别的运行了：按这次的报告定
  const tally = tallyOf([
    { status: 'succeeded' },
    { status: 'failed' },
    { status: 'failed', warn: true },
    { status: 'succeeded', block: true },
  ])
  assert.deepEqual(tally, { total: 3, failed: 1 })
  assert.equal(runPhase({ calling: false, failed: false, runId: 'r1', job: job({ runId: 'r0' }), tally }), 'failed') // 执行前没通过：前置不满足（GameTest 2.8.0），作业带 outcome 或按报告推
  assert.equal(
    runPhase({ calling: false, failed: false, runId: 'r1', job: job({ failed: 1, outcome: 'blocked' }) }),
    'blocked',
  )
  const blocked = tallyOf([
    { status: 'failed', setup: true },
    { status: 'skipped', path: 'steps.0' },
  ])
  assert.equal(
    runPhase({ calling: false, failed: false, runId: 'r1', job: job({ runId: 'r0' }), tally: blocked }),
    'blocked',
  )
})

test('跳到 GameTest 页的子路径：脚本路径带上运行号，拆回来一样', () => {
  assert.deepEqual(parseRunSub(runSub('a/b.json', 'r9')), { path: 'a/b.json', run: 'r9' })
  assert.deepEqual(parseRunSub('a/b.json'), { path: 'a/b.json' })
})

test('跑着时的一行：写了名称先显示名称、其次说明、结果退后；没写照旧动作名 + 结果', () => {
  assert.deepEqual(liveStepLine({ action: 'api', message: '已调 项目.Api.Pick → null', note: '选第一个剧情选项' }), {
    title: '选第一个剧情选项',
    detail: '已调 项目.Api.Pick → null',
    code: false,
  })
  assert.equal(liveStepLine({ action: 'api', title: '选第一个选项', note: '很长的详细说明……' }).title, '选第一个选项')
  assert.deepEqual(liveStepLine({ action: 'wait', message: '等条件成立', note: '  ' }), {
    title: 'wait',
    detail: '等条件成立',
    code: true,
  })
})
