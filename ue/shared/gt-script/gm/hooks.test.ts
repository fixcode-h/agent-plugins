import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addHook, hookCount, makeHook, moveHook, moveHookTo, pasteHooks, removeHook } from './hooks.ts'

const a = makeHook({ kind: 'cpp', name: 'A' })
const b = makeHook({ kind: 'cpp', name: 'B' })

test('增删、排序、挪组；空组和空 hooks 不留', () => {
  let s = addHook(addHook({ action: 'mark' }, 'before', a), 'before', b)
  assert.equal(hookCount(s), 2)
  s = moveHook(s, 'before', 1, 0)
  assert.deepEqual(
    (s.hooks as { before: { gm: { name: string } }[] }).before.map((x) => x.gm.name),
    ['B', 'A'],
  )
  s = moveHookTo(s, 'before', 0, 'fail')
  assert.deepEqual(Object.keys(s.hooks as object), ['before', 'fail'])
  s = removeHook(removeHook(s, 'before', 0), 'fail', 0)
  assert.equal(s.hooks, undefined)
  assert.deepEqual(s, { action: 'mark' })
})

test('粘贴别的节点的 GM：各组接在后面，拷一份', () => {
  const from = addHook({ action: 'mark' }, 'after', a)
  const to = pasteHooks(addHook({ action: 'click' }, 'after', b), from)
  const after = (to.hooks as { after: unknown[] }).after
  assert.equal(after.length, 2)
  assert.notEqual(after[1], a)
})
