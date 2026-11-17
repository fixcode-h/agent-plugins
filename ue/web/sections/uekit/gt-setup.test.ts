// 运行配置的前置步骤、随机种子校验。用法：node --test ue/web/sections/uekit/gt-setup.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setHost } from '../../host.ts'
import { parseSeed, parseSetup } from './gt-setup.ts'

setHost({ t: (zh: string) => zh } as never)

test('前置步骤', () => {
  assert.deepEqual(parseSetup(''), { steps: [] })
  assert.equal(parseSetup('[{"action":"console","command":"gm.X"}]').steps?.length, 1)
  assert.ok(parseSetup('{"action":"x"}').error)
  assert.ok(parseSetup('[{"command":"x"}]').error)
  assert.ok(parseSetup('[').error)
})

test('随机种子', () => {
  assert.deepEqual(parseSeed(''), {})
  assert.deepEqual(parseSeed('42'), { seed: 42 })
  assert.ok(parseSeed('4.2').error)
  assert.ok(parseSeed('abc').error)
})
