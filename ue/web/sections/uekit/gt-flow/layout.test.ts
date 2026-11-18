import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GtScript } from '../../../../shared/gt-script/index.ts'
import { layoutFlow, SIZE } from './layout.ts'

const doc: GtScript = {
  schemaVersion: 3,
  guards: [{ id: 'g1', name: '新手引导出现', when: {}, do: [{ action: 'call', script: 'common/翻完引导' }] }],
  steps: [
    { id: 's1', action: 'call', script: 'common/登录' },
    {
      id: 'loop1',
      action: 'loop',
      each: 'WBP_Welfare:Root/DailyList',
      max: 10,
      do: [
        {
          id: 'if1',
          action: 'if',
          cond: { target: '$item>BtnClaim', textLike: '领取' },
          then: [
            { id: 's2', action: 'click', target: '$item>BtnClaim' },
            { id: 's3', action: 'wait', target: 'WBP_RewardPopup:.' },
          ],
        },
      ],
    },
    { id: 'rec', action: 'group', recorded: true, do: [{ action: 'click' }, { action: 'key' }] },
  ],
}

const byId = (l: ReturnType<typeof layoutFlow>, id: string) => {
  const n = l.nodes.find((x) => x.id === id)
  assert.ok(n, `没有节点 ${id}`)
  return n
}

test('主流程从左到右：开始 → 各步 → 结束，连线带插入位置', () => {
  const l = layoutFlow(doc)
  const xs = ['#start', 's1', 'loop1', 'rec', '#end'].map((id) => byId(l, id).x)
  assert.deepEqual(
    [...xs].sort((a, b) => a - b),
    xs,
  )
  const first = l.edges.find((e) => e.from === '#start')
  assert.deepEqual(first?.insert, { slot: ['steps'], index: 0 })
  const last = l.edges.find((e) => e.to === '#end')
  assert.deepEqual(last?.insert, { slot: ['steps'], index: 3 })
  const mid = l.edges.find((e) => e.from === 's1' && e.to === 'loop1')
  assert.deepEqual(mid?.insert, { slot: ['steps'], index: 1 })
})

test('循环画成框，框里的步骤在框内，并有一条「下一轮」回线', () => {
  const l = layoutFlow(doc)
  const loop = byId(l, 'loop1')
  assert.equal(loop.kind, 'frame')
  assert.equal(loop.tone, 'loop')
  for (const id of ['if1', 's2', 's3']) {
    const n = byId(l, id)
    assert.ok(n.x > loop.x && n.x + n.w < loop.x + loop.w, `${id} 在框里`)
    assert.ok(n.y > loop.y && n.y + n.h < loop.y + loop.h, `${id} 在框里`)
  }
  // 框里只有一个如果块：回线从汇合点回到判断节点
  const back = l.edges.find((e) => e.kind === 'back')
  assert.equal(back?.from, 'if1#merge')
  assert.equal(back?.to, 'if1')
  assert.ok(back!.channelY! > byId(l, 's3').y)
})

test('如果：两支上下排开，空的「否则」直接连到汇合点、线上能插', () => {
  const l = layoutFlow(doc)
  const els = l.edges.find((e) => e.from === 'if1' && e.slotKind === 'else')
  assert.equal(els?.to, 'if1#merge')
  assert.deepEqual(els?.insert, { slot: ['steps', 1, 'do', 0, 'else'], index: 0 })
  const then = l.edges.find((e) => e.from === 'if1' && e.slotKind === 'then')
  assert.equal(then?.to, 's2')
  const join = l.edges.find((e) => e.from === 's3' && e.to === 'if1#merge')
  assert.deepEqual(join?.insert, { slot: ['steps', 1, 'do', 0, 'then'], index: 2 })
})

test('录制段默认折叠成一个节点，写着藏了几步；展开后是框', () => {
  const folded = byId(layoutFlow(doc), 'rec')
  assert.equal(folded.kind, 'step')
  assert.equal(folded.hidden, 2)
  const open = byId(layoutFlow(doc, { collapsed: () => false }), 'rec')
  assert.equal(open.kind, 'frame')
})

test('守护在主流程下方竖着排成一列，全局的在上', () => {
  const l = layoutFlow(doc, { globalGuards: [{ id: 'G', name: '断线重连' }] })
  const rail = byId(l, '#guards')
  const main = Math.max(...l.nodes.filter((n) => n.kind !== 'rail' && n.kind !== 'guard').map((n) => n.y + n.h))
  assert.ok(rail.y >= main + SIZE.railGap - 1)
  const rows = l.nodes.filter((n) => n.kind === 'guard')
  assert.deepEqual(
    rows.map((r) => [r.scope, r.key]),
    [
      ['global', 'G'],
      ['script', 'g1'],
    ],
  )
  assert.equal(rows[0].x, rows[1].x)
  assert.ok(rows[1].y > rows[0].y)
  assert.ok(rows[1].y + rows[1].h <= rail.y + rail.h)
})

test('空场景：开始直接连到结束，空槽也能插', () => {
  const l = layoutFlow({ schemaVersion: 3, steps: [] })
  assert.deepEqual(
    l.edges.map((e) => [e.from, e.to, e.insert]),
    [['#start', '#end', { slot: ['steps'], index: 0 }]],
  )
  const loop = layoutFlow({ steps: [{ id: 'l', action: 'loop', times: 3, do: [] }] })
  const empty = loop.nodes.find((n) => n.kind === 'empty')
  assert.deepEqual(empty?.insert, { slot: ['steps', 0, 'do'], index: 0 })
})

test('没有 id 的步骤按路径记', () => {
  const l = layoutFlow({ steps: [{ action: 'click' }] })
  assert.ok(l.nodes.some((n) => n.id === 'steps.0' && n.key === 'steps.0'))
})
