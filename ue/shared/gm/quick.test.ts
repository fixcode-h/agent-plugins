import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitArgs, rankQuick, splitQuick, tokenize } from './quick.ts'

test('快速执行：拆名字和参数，引号里算一个', () => {
  assert.deepEqual(tokenize(`AddItem 1001 "a b" 'c d'`), ['AddItem', '1001', 'a b', 'c d'])
  assert.deepEqual(splitQuick('  God  '), { name: 'God', args: [] })
})

test('快速执行：多出来的参数并进最后一个，没参数的不收', () => {
  assert.deepEqual(fitArgs(['1', 'hello', 'world'], 2), ['1', 'hello world'])
  assert.deepEqual(fitArgs(['1'], 2), ['1'])
  assert.deepEqual(fitArgs(['1'], 0), [])
})

test('快速执行：补全按开头、长短、包含排', () => {
  const items = ['AddItemBatch', 'AddItem', 'GodMode', 'ResetAdd'].map((name) => ({ name, kind: 'lua' }))
  assert.deepEqual(
    rankQuick(items, 'add').map((x) => x.name),
    ['AddItem', 'AddItemBatch', 'ResetAdd'],
  )
  assert.deepEqual(rankQuick(items, ' '), [])
})
