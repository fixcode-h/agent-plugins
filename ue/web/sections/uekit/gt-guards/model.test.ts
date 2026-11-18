import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blankGuard, blockersToGuards, tidyGuards } from './model.ts'

test('阻挡界面按协议 5.1 改写成守护', () => {
  const g = blockersToGuards([
    { widget: 'WBP_Notice', action: 'close', delayMs: 300 },
    { widget: 'WBP_Guide', action: 'call', function: 'OnSkip', note: '引导', enabled: false },
    { widget: 'WBP_Event', action: 'command', command: 'gm.SkipEvent' },
    { widget: '  ', action: 'close' },
  ])
  assert.equal(g.length, 3)
  assert.deepEqual(g[0], {
    id: 'b1',
    name: 'WBP_Notice',
    when: { target: 'WBP_Notice:.', onScreen: true, settleMs: 300 },
    do: [{ action: 'widget.close', target: 'WBP_Notice:.' }],
  })
  assert.deepEqual(g[1].do, [{ action: 'widget.call', target: 'WBP_Guide:.', function: 'OnSkip' }])
  assert.equal(g[1].name, '引导')
  assert.equal(g[1].disabled, true)
  assert.deepEqual(g[2].do, [{ action: 'console', command: 'gm.SkipEvent' }])
})

test('存盘前去掉默认值和空条', () => {
  const out = tidyGuards([
    { id: 'g1', when: { target: 'A:.' }, do: [], max: 20, after: 'retry', cooldownMs: 500, name: '' },
    { id: 'g2' },
  ])
  assert.deepEqual(out, [{ id: 'g1', when: { target: 'A:.' }, do: [], cooldownMs: 500 }])
})

test('新守护的 id 不和已有的撞', () => {
  assert.equal(blankGuard(new Set(['g1', 'g2'])).id, 'g3')
})
