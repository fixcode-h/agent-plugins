// 编辑器忙时从日志尾部认出在忙什么：不需要 UE。
// 用法：node --test ue/server/busy/activity.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guessBusy } from './activity.ts'

test('认出加载地图，带地图名', () => {
  const g = guessBusy(
    [
      '[2026.11.16-07.33.10:001][  0]LogInit: Display: something',
      '[2026.11.16-07.33.15:123][  0]LogEditorServer: LoadMap: /Game/Maps/Main',
    ].join('\n'),
  )
  assert.equal(g.kind, 'map')
  assert.equal(g.detail, '/Game/Maps/Main')
  assert.equal(g.line, 'LogEditorServer: LoadMap: /Game/Maps/Main')
})

test('认出同步加载资源，带包路径', () => {
  const g = guessBusy(
    '[2026.11.16-07.33.15:123][  5]LogStreaming: Display: FlushAsyncLoading(Pkg): /Game/UI/WBP_Bag\r\n',
  )
  assert.equal(g.kind, 'assets')
  assert.equal(g.detail, '/Game/UI/WBP_Bag')
})

test('认出编译着色器和剩余个数', () => {
  const g = guessBusy('LogShaderCompilers: Display: Worker (3/24): shaders left to compile 1234')
  assert.equal(g.kind, 'shaders')
  assert.equal(g.detail, '1234')
})

test('认不出时只给最后一行；空文本什么都不给', () => {
  const g = guessBusy('LogTemp: hello\nLogTemp: world\n')
  assert.equal(g.kind, undefined)
  assert.equal(g.line, 'LogTemp: world')
  assert.deepEqual(guessBusy(''), {})
})

test('只看最近几行：早就过去的加载不算', () => {
  const old = 'LogStreaming: Display: loading /Game/Old'
  const recent = Array.from({ length: 20 }, (_, i) => `LogTemp: line ${i}`)
  assert.equal(guessBusy([old, ...recent].join('\n')).kind, undefined)
})
