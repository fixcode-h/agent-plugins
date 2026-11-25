// Agent 自己在游戏里测试前的授权卡（self-test-gate.ts）：哪些调用拦、带的规则键、拒绝时交回的说明
// 用法：node --test ue/server/self-test-gate.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PluginConfirm, PluginServerContext } from '../../sdk/server.ts'
import type { OpCtx } from './ops.ts'
import { needsSelfTest, SELF_TEST_RULE, selfTestGate } from './self-test-gate.ts'
import { setCtx } from './util.ts'

setCtx({
  t: (zh: string, vars?: Record<string, string | number>) =>
    zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
} as unknown as PluginServerContext)

const ctx = (allow: boolean, seen: PluginConfirm[]) =>
  ({
    project: {},
    actor: { kind: 'agent', taskId: 't1' },
    confirm: async (req: PluginConfirm) => {
      seen.push(req)
      return { allow, message: '' }
    },
  }) as unknown as OpCtx

test('只拦跑测试、执行 GM、开 PIE，查询和演练不拦', () => {
  assert.equal(needsSelfTest('ue_gametest', { action: 'run', scenario: 'a.json' }), true)
  assert.equal(needsSelfTest('ue_gametest', { action: 'step' }), true)
  assert.equal(needsSelfTest('ue_gametest', { action: 'look', what: 'status' }), false)
  assert.equal(needsSelfTest('ue_gametest', { action: 'validate' }), false)
  assert.equal(needsSelfTest('ue_gm', { action: 'run', name: 'AddItem' }), true)
  assert.equal(needsSelfTest('ue_gm', { action: 'list' }), false)
  assert.equal(needsSelfTest('ue_gm', { action: 'save', dryRun: true }), false)
  assert.equal(needsSelfTest('ue_editor', { action: 'pie_start' }), true)
  assert.equal(needsSelfTest('ue_editor', { action: 'start_editor' }), false)
  assert.equal(needsSelfTest('ue_call', { path: 'x', function: 'f' }), false)
})

test('同意了放行，卡片带本对话不再询问的规则键', async () => {
  const seen: PluginConfirm[] = []
  assert.equal(
    await selfTestGate('ue_gametest', { action: 'run', scenario: 'regression/Bag/sell.json' }, ctx(true, seen)),
    '',
  )
  assert.equal(seen.length, 1)
  assert.equal(seen[0].rule, SELF_TEST_RULE)
  assert.match(seen[0].detail ?? '', /regression\/Bag\/sell\.json/)
})

test('拒绝了交回说明，叫它别绕路', async () => {
  const seen: PluginConfirm[] = []
  const r = await selfTestGate('ue_gm', { action: 'run', name: 'AddItem', args: [1001] }, ctx(false, seen))
  assert.match(r, /没同意/)
  assert.match(r, /不要换别的工具/)
})

test('不需要卡的调用不弹，用户在页面上点的也不弹', async () => {
  const seen: PluginConfirm[] = []
  assert.equal(await selfTestGate('ue_gametest', { action: 'report' }, ctx(false, seen)), '')
  const user = { ...ctx(false, seen), actor: { kind: 'user' } } as OpCtx
  assert.equal(await selfTestGate('ue_gametest', { action: 'run', tag: 'regression' }, user), '')
  assert.equal(seen.length, 0)
})
