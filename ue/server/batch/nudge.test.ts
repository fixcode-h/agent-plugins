// 逐个调的提醒（batch/nudge.ts）。用法（在仓库根）：node scripts/test.mjs ue server/batch/nudge.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { McpResult } from '../../../sdk/server.ts'
import './actions/props.ts'
import { batchNudge } from './nudge.ts'

const ok = () => ({ content: [{ type: 'text' as const, text: 'ok' }] })
const texts = (r: McpResult) => r.content.map((c) => ('text' in c ? c.text : '')).join('')

test('同一对话第 3 次对不同资源单独改同一个属性时提醒一次', () => {
  const call = (p: string) => batchNudge('t1', 'ue_set', { path: p, prop: 'Mobility', value: 'Static' }, ok())
  assert.doesNotMatch(texts(call('/Game/A')), /提示/)
  assert.doesNotMatch(texts(call('/Game/B')), /提示/)
  assert.match(texts(call('/Game/C')), /paths=\[所有路径\]/)
  // 十分钟内不再提醒
  assert.doesNotMatch(texts(call('/Game/D')), /提示/)
})

test('批量调用、别的属性、同一个资源重复调都不算', () => {
  assert.doesNotMatch(texts(batchNudge('t2', 'ue_set', { paths: ['/Game/A'], prop: 'X' }, ok())), /提示/)
  for (const prop of ['A', 'B', 'C'])
    assert.doesNotMatch(texts(batchNudge('t2', 'ue_set', { path: `/Game/${prop}`, prop }, ok())), /提示/)
  for (let i = 0; i < 3; i++)
    assert.doesNotMatch(texts(batchNudge('t3', 'ue_set', { path: '/Game/A', prop: 'X' }, ok())), /提示/)
})
