import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentLookPrompt } from './agent-look-prompt.ts'

test('让 Agent 看：带技能、步骤、场景路径、证据和报告细节', () => {
  const s = agentLookPrompt({
    scenario: { name: '背包出售', relativePath: 'bag/sell.json' },
    root: 'docs/GameTest',
    index: 3,
    def: { id: 's4', action: 'click', target: 'WBP_Bag:Btn_Sell' },
    message: '等控件可点超时',
    payload: { code: 'timeout', guards: [{ id: 'g1', ok: true }] },
    evidence: { screenshot: 'Saved/GameTest/e/1.png', log: 'Saved/GameTest/e/log.txt', selectorError: '候选 Btn_SellAll' },
  })
  assert.ok(s.startsWith('/ue-gametest-authoring'))
  assert.match(s, /第 4 步（id s4）（click）失败：等控件可点超时/)
  assert.match(s, /docs\/GameTest\/bag\/sell\.json/)
  assert.match(s, /截图 Saved\/GameTest\/e\/1\.png/)
  assert.match(s, /找不到控件：候选 Btn_SellAll/)
  assert.match(s, /- code: "timeout"/)
  // 没证据时提示自己复现
  assert.match(agentLookPrompt({ scenario: { name: 'a', relativePath: 'a.json' }, index: 0 }), /没有留下失败证据/)
})
