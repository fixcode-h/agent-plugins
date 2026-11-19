// 写后编译钩子的记录：编过的不再编、没带编译的修改清掉标记、保存的包取一次就清。
// 用法：node --test ue/server/bp-check/state.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compiledOk, noteCompile, noteSaved, packageName, takeSaved } from './state.ts'

test('编译结果按对话记：通过的跳过，之后没带编译又改过的要重编', () => {
  noteCompile('t1', packageName('/Game/BP_Hero.BP_Hero'), true)
  assert.equal(compiledOk('t1', '/Game/BP_Hero'), true)
  assert.equal(compiledOk('t2', '/Game/BP_Hero'), false)
  noteCompile('t1', '/Game/BP_Hero', undefined)
  assert.equal(compiledOk('t1', '/Game/BP_Hero'), false)
  noteCompile('t1', '/Game/BP_Hero', false)
  assert.equal(compiledOk('t1', '/Game/BP_Hero'), false)
})

test('保存的包合并去重，取一次就清掉；换了项目只留新的', () => {
  noteSaved('t1', 'p1', ['/Game/A', '/Game/B'])
  noteSaved('t1', 'p1', ['/Game/B', '/Game/C'])
  assert.deepEqual(takeSaved('t1'), { projectId: 'p1', packages: ['/Game/A', '/Game/B', '/Game/C'] })
  assert.equal(takeSaved('t1'), undefined)
  noteSaved('t1', 'p1', ['/Game/A'])
  noteSaved('t1', 'p2', ['/Game/X'])
  assert.deepEqual(takeSaved('t1'), { projectId: 'p2', packages: ['/Game/X'] })
  noteSaved('t1', 'p1', [])
  assert.equal(takeSaved('t1'), undefined)
})
