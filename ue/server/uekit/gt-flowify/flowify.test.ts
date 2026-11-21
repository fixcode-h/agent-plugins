import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyTidyDoc, parseTidyPlan } from '../gt-tidy-plan.ts'
import { runFlowRules } from './index.ts'

const plan = (changes: unknown[], n: number) => parseTidyPlan({ scenario: { root: 'r', path: 'p' }, changes }, n)
const all = (n: number) => Array.from({ length: n }, (_, i) => i)

test('重复点击 → 删掉后几次 + 第一次包成循环，做到下一步目标出现为止', () => {
  const steps = [
    { id: 's1', action: 'click', target: 'WBP_Shop:Btn_Next' },
    { id: 's2', action: 'click', target: 'WBP_Shop:Btn_Next' },
    { id: 's3', action: 'click', target: 'WBP_Shop:Btn_Next' },
    { id: 's4', action: 'click', target: 'WBP_Shop:Btn_Buy' },
  ]
  const hints = runFlowRules(steps)
  assert.equal(hints.length, 1)
  assert.equal(hints[0].rule, 'repeat')
  const p = plan(hints[0].changes, steps.length)
  const out = applyTidyDoc(steps, p, all(p.changes.length), false)
  assert.equal(out.v3, true)
  assert.equal(out.steps.length, 2)
  const loop = out.steps[0] as Record<string, unknown>
  assert.equal(loop.action, 'loop')
  assert.deepEqual(loop.until, { target: 'WBP_Shop:Btn_Buy', visible: true })
  assert.equal((loop.do as { id: string }[])[0].id, 's1')
})

test('中途弹窗 → 守护，再次弹出的删掉；主界面不算弹窗', () => {
  const steps = [
    { action: 'click', target: 'WBP_Main:Btn_Bag' },
    { action: 'click', target: 'WBP_Notice:Btn_Close' },
    { action: 'click', target: 'WBP_Bag:Btn_Sell' },
    { action: 'click', target: 'WBP_Notice:Btn_Close' },
    { action: 'click', target: 'WBP_Bag:Btn_Ok' },
  ]
  const hints = runFlowRules(steps)
  const g = hints.find((h) => h.rule === 'popup-guard')!
  assert.deepEqual(g.steps, [2, 4])
  const p = plan(g.changes, steps.length)
  const out = applyTidyDoc(steps, p, all(p.changes.length), false)
  assert.equal(out.steps.length, 3)
  assert.equal(out.guards.length, 1)
  assert.deepEqual(out.guards[0].when, { target: 'WBP_Notice:.', onScreen: true })
  assert.equal((out.guards[0].do as unknown[]).length, 1)
})

test('同一个 skipIf → 如果，edit 和 wrap 可以叠在同一步', () => {
  const cond = { target: 'WBP_Guide:.', onScreen: false }
  const steps = [
    { action: 'click', target: 'WBP_Guide:Btn_A', skipIf: cond },
    { action: 'click', target: 'WBP_Guide:Btn_B', skipIf: cond },
    { action: 'key', key: 'E' },
  ]
  const h = runFlowRules(steps).find((x) => x.rule === 'skip-if')!
  const p = plan(h.changes, steps.length)
  const out = applyTidyDoc(steps, p, all(p.changes.length), false)
  const iff = out.steps[0] as Record<string, unknown>
  assert.equal(iff.action, 'if')
  assert.deepEqual(iff.cond, { not: cond })
  assert.equal(
    (iff.then as Record<string, unknown>[]).every((s) => !('skipIf' in s)),
    true,
  )
})

test('和现成脚本一样的一段 → call；输入的值 → 参数', () => {
  const login = [
    { action: 'click', target: 'WBP_Login:Input_Account' },
    { action: 'type', target: 'WBP_Login:Input_Account', text: 'qa_01' },
    { action: 'click', target: 'WBP_Login:Btn_Login' },
  ]
  const steps = [
    ...login,
    { action: 'type', target: 'WBP_Chat:Input_Msg', text: 'hello' },
    { action: 'key', key: 'Enter' },
  ]
  const hints = runFlowRules(steps, [{ rel: 'common/登录', steps: login }])
  const call = hints.find((h) => h.rule === 'same-script')!
  assert.deepEqual(call.steps, [1, 2, 3])
  const params = hints.filter((h) => h.rule === 'input-param')
  assert.deepEqual(
    params.map((h) => h.changes[0].name),
    ['account', 'msg'],
  )
  // 参数和 replace 同时勾：参数落在被替换掉的步骤上不报错
  const p = plan([...call.changes, ...params[1].changes], steps.length)
  const out = applyTidyDoc(steps, p, all(p.changes.length), false)
  assert.equal(out.steps[0].action, 'call')
  assert.equal(out.steps[1].text, '$msg')
  assert.deepEqual(out.params.msg, { default: 'hello' })
})

test('两条改动都要搬走同一步时整份退回', () => {
  assert.throws(
    () =>
      plan(
        [
          { what: 'a', op: 'wrap', steps: [1, 2], block: { action: 'group' } },
          { what: 'b', op: 'guard', steps: [2], guard: { when: { target: 'X:.', onScreen: true } } },
        ],
        3,
      ),
    /都改了原第 2 步/,
  )
})

test('v5 录制（部件写法）：循环的 until、弹窗守护的 when 写成对象判断', () => {
  const next = { obj: { class: 'WBP_Shop' }, part: 'Btn_Next' }
  const steps = [
    { action: 'click', target: next },
    { action: 'click', target: next },
    { action: 'click', target: next },
    { action: 'click', target: { obj: { class: 'WBP_Shop' }, part: 'Btn_Buy' } },
  ]
  const rep = runFlowRules(steps)
  const p = plan(rep[0].changes, 4)
  const loop = applyTidyDoc(steps, p, all(p.changes.length), false).steps[0] as Record<string, unknown>
  assert.deepEqual(loop.until, { obj: { class: 'WBP_Shop' }, prop: '@/Btn_Buy:shown', op: 'is', value: true })

  const notice = { obj: { class: 'WBP_Notice' }, part: 'Btn_Close' }
  const hints = runFlowRules([
    { action: 'click', target: { obj: 'main', part: 'Btn_Bag' } },
    { action: 'click', target: notice },
    { action: 'click', target: { obj: 'bag', part: 'Btn_Sell' } },
    { action: 'click', target: { obj: 'bag', part: 'Btn_Ok' } },
  ])
  const g = hints.find((h) => h.rule === 'popup-guard')!
  const guard = (g.changes[0] as { guard: { when: unknown } }).guard
  assert.deepEqual(guard.when, { obj: { class: 'WBP_Notice' }, prop: '@:onScreen', op: 'is', value: true })
})
