// OCR 挑字（pick.ts）。用法：node --test ue/server/ocr/pick.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { meaningful, pickLabel } from './pick.ts'

const box = (text: string, b: [number, number, number, number], score = 0.95) => ({ text, box: b, score })

describe('pickLabel', () => {
  it('只认红框里的字：框外的邻居（背包计数）不算', () => {
    const items = [box('背包 (12/40)', [5, 6, 68, 17]), box('桌面摆件2', [81, 47, 98, 27])]
    assert.equal(pickLabel(items, [70, 40, 120, 40]), '桌面摆件2')
  })
  it('没有红框、置信度低、纯符号都不给', () => {
    assert.equal(pickLabel([box('确定', [10, 10, 40, 20])], undefined), undefined)
    assert.equal(pickLabel([box('确定', [10, 10, 40, 20], 0.4)], [0, 0, 100, 50]), undefined)
    assert.equal(pickLabel([box('>>', [10, 10, 40, 20])], [0, 0, 100, 50]), undefined)
  })
  it('同一行挨着的两段拼起来', () => {
    const items = [box('领取', [20, 10, 30, 20]), box('奖励', [55, 10, 30, 20])]
    assert.equal(pickLabel(items, [0, 0, 120, 40]), '领取奖励')
    assert.equal(
      pickLabel([box('Start', [20, 10, 40, 20]), box('Game', [65, 10, 40, 20])], [0, 0, 120, 40]),
      'Start Game',
    )
  })
  it('框里有大标题和小角标时取离中心近、字大的', () => {
    const items = [box('99', [100, 2, 14, 10]), box('商店', [40, 20, 40, 24])]
    assert.equal(pickLabel(items, [0, 0, 120, 64]), '商店')
  })
})

describe('meaningful', () => {
  it('单个数字留，单个汉字和符号不留', () => {
    assert.equal(meaningful('2'), true)
    assert.equal(meaningful('×'), false)
    assert.equal(meaningful('商'), false)
    assert.equal(meaningful('商店'), true)
  })
})
