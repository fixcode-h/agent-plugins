// 时间轴纯逻辑的单测：node --test ue/web/timeline/timeline.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { channelProps, normInterp, parseAnims, parseKey, sampleAnim, tickStep, valueAt } from './keys.ts'

test('关键帧：对象写法和 [t, v, interp] 简写都认', () => {
  assert.deepEqual(parseKey({ time: 0.3, value: 0.85, interp: 'cubic' }), { time: 0.3, value: 0.85, interp: 'cubic' })
  assert.deepEqual(parseKey([0.3, 0.85, 'linear']), { time: 0.3, value: 0.85, interp: 'linear' })
  // 没写插值是 cubic（AssetForge 默认）；UE 的 RCIM_Constant 也认
  assert.deepEqual(parseKey([0, 1]), { time: 0, value: 1, interp: 'cubic' })
  assert.equal(normInterp('RCIM_Constant'), 'constant')
  assert.equal(parseKey(['x', 1]), undefined)
  assert.equal(parseKey(null), undefined)
})

test('读 animations 段：按时间排序键、长度默认取最后一个键、坏条目跳过', () => {
  const anims = parseAnims([
    {
      name: 'PageIn',
      tracks: [
        {
          target: 'Root/Page',
          channel: 'RenderOpacity',
          keys: [[0.45, 1], { time: 0, value: 0 }, [0.3, 0.85, 'cubic']],
        },
        {
          target: 'Root/Page',
          channel: 'RenderTransform.Translation.X',
          keys: [{ time: 0, value: 60, interp: 'linear' }, [0.45, 0]],
        },
        'bad',
      ],
    },
    { name: 'Fixed', length: 2, tracks: [] },
    42,
  ])
  assert.equal(anims.length, 2)
  assert.equal(anims[0].length, 0.45)
  assert.deepEqual(
    anims[0].tracks[0].keys.map((k) => k.time),
    [0, 0.3, 0.45],
  )
  assert.equal(anims[1].length, 2)
  assert.deepEqual(parseAnims(undefined), [])
  // umg.anims 每段动画里的 skipped
  assert.equal(
    parseAnims([{ name: 'S', tracks: [], skipped: [{ target: 'A', channel: 'ColorAndOpacity' }] }])[0].skipped,
    'A ColorAndOpacity',
  )
  assert.equal(parseAnims([{ name: 'S', tracks: [], skipped: 0 }])[0].skipped, undefined)
})

test('求值：常量、线性、cubic，两头取端点', () => {
  const keys = [
    { time: 0, value: 0, interp: 'linear' as const },
    { time: 1, value: 10, interp: 'constant' as const },
    { time: 2, value: 20, interp: 'cubic' as const },
    { time: 3, value: 30, interp: 'cubic' as const },
  ]
  assert.equal(valueAt(keys, -1), 0)
  assert.equal(valueAt(keys, 0.5), 5)
  assert.equal(valueAt(keys, 1.5), 10)
  assert.equal(valueAt(keys, 2.5), 25)
  assert.ok((valueAt(keys, 2.25) as number) < 22.5, 'cubic 开头慢')
  assert.equal(valueAt(keys, 9), 30)
  assert.equal(valueAt([], 1), undefined)
  // 不是数字的值按常量
  assert.equal(
    valueAt(
      [
        { time: 0, value: 'Visible', interp: 'linear' },
        { time: 1, value: 'Collapsed', interp: 'linear' },
      ],
      0.5,
    ),
    'Visible',
  )
})

test('一段动画某时刻各控件各通道的值', () => {
  const [a] = parseAnims([
    {
      name: 'A',
      tracks: [
        {
          target: 'X',
          channel: 'RenderOpacity',
          keys: [
            [0, 0, 'linear'],
            [1, 1],
          ],
        },
        { target: 'X', channel: 'RenderTransform.Angle', keys: [[0, 90]] },
      ],
    },
  ])
  assert.deepEqual(sampleAnim(a, 0.5).get('X'), { RenderOpacity: 0.5, 'RenderTransform.Angle': 90 })
})

test('刻度取 1、2、5 的倍数；通道对应的细节属性', () => {
  assert.equal(tickStep(1, 1000, 64), 0.1)
  assert.equal(tickStep(0.8, 300, 64), 0.2)
  assert.equal(tickStep(10, 200, 64), 5)
  assert.equal(tickStep(0, 100), 1)
  assert.deepEqual(channelProps('RenderTransform.Translation.X'), ['RenderTransform'])
  assert.deepEqual(channelProps('slot.Padding.Left'), ['Slot.Padding', 'Slot'])
  assert.deepEqual(channelProps('RenderOpacity'), ['RenderOpacity'])
})
