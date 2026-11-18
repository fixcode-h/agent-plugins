import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setHost } from '../../host.ts'
import {
  condOf,
  condSay,
  parseSkipText,
  sameAsCand,
  skipFromCand,
  skipLabel,
  skipSupported,
  skipWith,
  stateOf,
} from './gt-skip.ts'

setHost({
  t: (zh: string, v?: Record<string, string | number>) => zh.replace(/\{(\w+)\}/g, (_, k: string) => String(v?.[k])),
} as never)

test('condOf 只留条件字段', () => {
  assert.deepEqual(condOf({ checked: true, target: 'A:B', also: 1, by: 'auto' }), { checked: true })
})

test('condSay 说成人话，any 用「或」', () => {
  assert.equal(condSay({ checked: true }), '已勾上')
  assert.equal(condSay({ textLike: '已领取' }), '文字像「已领取」')
  assert.equal(condSay({ any: [{ visible: false }, { enabled: false }] }), '看不见 或 变灰')
})

test('skipLabel 带连带步数', () => {
  assert.equal(skipLabel({ textLike: '已领取', also: 1 }), '文字像「已领取」就跳过 +1')
  assert.equal(skipLabel({ checked: true }), '已勾上就跳过')
})

test('skipFromCand 换条件和看的控件，保留 also / verify，by 改 user', () => {
  const s = skipFromCand(
    { kind: 'visible', target: 'WBP_A:Root/ImgTick', cond: { visible: true }, score: 7 },
    { checked: true, target: 'WBP_A:Root/Chk', also: 2, verify: false, by: 'auto' },
  )
  assert.deepEqual(s, { visible: true, target: 'WBP_A:Root/ImgTick', also: 2, verify: false, by: 'user' })
  // 候选看的是步骤自己的控件：不写 target
  assert.deepEqual(skipFromCand({ kind: 'text', cond: { textLike: '已领取' }, score: 8 }), {
    textLike: '已领取',
    by: 'user',
  })
})

test('sameAsCand 按条件和控件比', () => {
  const cand = { kind: 'checked', target: 'A:B', cond: { checked: true }, score: 10 }
  assert.equal(sameAsCand({ checked: true, target: 'A:B', by: 'auto', also: 1 }, cand), true)
  assert.equal(sameAsCand({ checked: false, target: 'A:B' }, cand), false)
  assert.equal(sameAsCand(undefined, cand), false)
})

test('stateOf 丢掉形状不对的候选', () => {
  const s = stateOf({
    state: { cands: [{ kind: 'checked', cond: { checked: true }, score: 10 }, { kind: 1 }], picked: 0 },
  })
  assert.equal(s?.cands.length, 1)
  assert.equal(s?.picked, 0)
  assert.equal(stateOf({}), undefined)
})

test('parseSkipText 检查字段和至少一个条件', () => {
  assert.deepEqual(parseSkipText('{"checked":true,"also":1}').skip, { checked: true, also: 1 })
  assert.ok(parseSkipText('{"checkd":true}').error)
  assert.ok(parseSkipText('{"also":1}').error)
  assert.ok(parseSkipText('[1]').error)
  assert.ok(parseSkipText('{').error)
})

test('skipSupported 按 GameTest 版本', () => {
  assert.equal(skipSupported('1.6.0'), false)
  assert.equal(skipSupported('1.7.0'), true)
  assert.equal(skipSupported('1.7.0-beta.1'), true)
  assert.equal(skipSupported(undefined), true)
})

test('skipWith 读连带跳过的带头步', () => {
  assert.equal(skipWith({ skip: { with: 3 } }), 3)
  assert.equal(skipWith({ skip: { say: 'x' } }), undefined)
})
