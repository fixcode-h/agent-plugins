// UE 插件页给哪一版扩展：正式版要的引擎比项目新、预发布版支持时给预发布版（GameTest 正式版要 5.8、预发布支持 5.4）。
// 用法：node --test ue/server/uekit/catalog-offer.test.ts（Node 22 直接跑 .ts，不需要 UE）
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { UeProject } from '../types.ts'
import { pickOffer } from './offer.ts'

const proj = (version: string) => ({ engine: { version } }) as UeProject
const m = (version: string, engineMin: string) =>
  ({ name: 'GameTest', version, engineMin }) as { name: string; version: string; engineMin: string }

test('正式版引擎够用时给正式版', () => {
  const e = { latest: m('1.1.0', '5.4'), prerelease: m('1.2.0-beta.1', '5.4') }
  assert.equal(pickOffer(proj('5.4.1'), e)?.version, '1.1.0')
})

test('正式版要 5.8、预发布支持 5.4 时，5.4 项目给预发布', () => {
  const e = { latest: m('1.1.0', '5.8'), prerelease: m('1.2.0-beta.1', '5.4') }
  assert.equal(pickOffer(proj('5.4.1'), e)?.version, '1.2.0-beta.1')
  assert.equal(pickOffer(proj('5.8.0'), e)?.version, '1.1.0')
})

test('两版都不支持时仍给正式版（让页面显示引擎太旧）', () => {
  const e = { latest: m('1.1.0', '5.8'), prerelease: m('1.2.0-beta.1', '5.6') }
  assert.equal(pickOffer(proj('5.4.1'), e)?.version, '1.1.0')
})

test('已装预发布版的继续给预发布，没有正式版时给预发布', () => {
  const e = { latest: m('1.1.0', '5.4'), prerelease: m('1.2.0-beta.1', '5.4') }
  assert.equal(pickOffer(proj('5.8.0'), e, '1.1.1-beta.1')?.version, '1.2.0-beta.1')
  assert.equal(
    pickOffer(proj('5.8.0'), { latest: null, prerelease: m('1.0.0-beta.1', '5.8') })?.version,
    '1.0.0-beta.1',
  )
})
