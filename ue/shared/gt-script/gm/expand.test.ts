import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GmCustom } from '../../gm/schema.ts'
import { expandScript, type GmLib } from './expand.ts'

const buy: GmCustom = {
  id: 'c1',
  name: '买东西',
  module: 'm',
  kind: 'call',
  obj: '商店',
  objects: { 商店: { ref: { class: 'WBP_Shop' } }, 'lua:店主': { src: '@luaMod.Npc' } },
  function: 'BuyItem',
  args: { ItemId: 1, Buyer: { $obj: 'lua:店主' } },
  editable: ['ItemId'],
  many: 'error',
}
const lib: GmLib = {
  gm: {
    custom: [buy],
    macros: [{ id: 'm1', name: '开局', onFail: 'skip', steps: [{ console: 'god' }, { wait: 2 }, { gm: 'AddGold', args: ['100'] }] }],
  },
  luaCode: (name, args) => (name === 'Heal' ? { code: `GM.Heal(${args.join(', ')})` } : { error: `没有 ${name}` }),
}

test('每种 GM 展开成对应的步骤，$变量原样交给运行时', () => {
  const { doc, issues } = expandScript(
    {
      steps: [
        { action: 'gm.run', id: 'a', gm: { kind: 'cpp', name: 'AddGold', args: ['$n'] } },
        { action: 'gm.run', id: 'b', gm: { kind: 'lua', name: 'Heal', args: [5] } },
        { action: 'gm.run', id: 'c', gm: { kind: 'console', name: 'stat', args: ['fps'] } },
        { action: 'mark', text: 'x', hooks: { after: [{ action: 'gm.run', gm: { kind: 'custom', name: 'c1', args: { ItemId: '$ret' } } }] } },
      ],
    },
    lib,
  )
  assert.deepEqual(issues, [])
  const s = doc.steps!
  assert.deepEqual(s[0].run, [{ action: 'api', api: 'Gm.Run', args: { name: 'AddGold', args: ['$n'] } }])
  assert.deepEqual(s[1].run, [{ action: 'api', api: 'Gm.Lua', args: { code: 'GM.Heal(5)', name: 'Heal' } }])
  assert.deepEqual(s[2].run, [{ action: 'console', command: 'stat fps' }])
  const call = ((s[3].hooks as { after: { run: Record<string, unknown>[] }[] }).after[0].run)[0]
  assert.equal(call.action, 'obj.call')
  assert.deepEqual(call.args, { ItemId: '$ret', Buyer: { $obj: 'lua_店主' } })
  assert.deepEqual(doc.objects, { 商店: { class: 'WBP_Shop' }, lua_店主: '@luaMod.Npc' })
  assert.deepEqual(doc.gmObjects, ['lua_店主', '商店'])
})

test('宏逐步展开，onFail=skip 每步 continue；没用到的对象下次收掉', () => {
  const first = expandScript({ steps: [{ action: 'gm.run', gm: { kind: 'custom', name: 'c1' } }] }, lib).doc
  const { doc } = expandScript({ ...first, steps: [{ action: 'gm.run', gm: { kind: 'macro', name: 'm1' } }] }, lib)
  assert.deepEqual(doc.steps![0].run, [
    { action: 'console', command: 'god', onFail: 'continue' },
    { action: 'wait', until: 'seconds', seconds: 2, onFail: 'continue' },
    { action: 'api', api: 'Gm.Run', args: { name: 'AddGold', args: ['100'] }, onFail: 'continue' },
  ])
  assert.equal(doc.objects, undefined)
  assert.equal(doc.gmObjects, undefined)
})

test('找不到 GM、Lua 参数用变量、改不能改的参数都记 issue，留着旧的 run', () => {
  const { doc, issues } = expandScript(
    {
      steps: [
        { action: 'gm.run', id: 'gone', gm: { kind: 'custom', name: 'nope', label: '旧的' }, run: [{ action: 'mark' }] },
        { action: 'gm.run', id: 'lua', gm: { kind: 'lua', name: 'Heal', args: ['$x'] } },
        { action: 'gm.run', id: 'ro', gm: { kind: 'custom', name: 'c1', args: { Buyer: 1 } } },
      ],
    },
    lib,
  )
  assert.deepEqual(
    issues.map((i) => i.at),
    ['gone', 'lua', 'ro'],
  )
  assert.match(issues[0].message, /旧的/)
  assert.deepEqual(doc.steps![0].run, [{ action: 'mark' }])
})

test('同名不同规则的对象加 _2，脚本原有的不收', () => {
  const { doc } = expandScript(
    { objects: { 商店: { class: 'Other' } }, steps: [{ action: 'gm.run', gm: { kind: 'custom', name: 'c1' } }] },
    lib,
  )
  assert.deepEqual((doc.objects as Record<string, unknown>)['商店'], { class: 'Other' })
  assert.deepEqual((doc.objects as Record<string, unknown>)['商店_2'], { class: 'WBP_Shop' })
  assert.deepEqual(((doc.steps![0].run as Record<string, unknown>[])[0].obj), { $obj: '商店_2' })
  assert.deepEqual(doc.gmObjects, ['lua_店主', '商店_2'])
  // 没有 gm.run 的脚本原样返回
  const plain = { steps: [{ action: 'mark' }] }
  assert.equal(expandScript(plain, lib).doc, plain)
})
