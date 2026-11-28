import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { luaTargets, testLuaDeny } from './guard.ts'

const root = mkdtempSync(path.join(tmpdir(), 'gt-lua-guard-'))
writeFileSync(path.join(root, 'Old.lua'), 'return {}')
const input = (agent: string, tool: { kind: string; input: Record<string, unknown> }) =>
  ({
    event: 'tool.before',
    task: { id: 't', title: '', parent: false },
    project: { id: 'p', path: root },
    agent: { id: agent, name: '' },
    cli: 'claude',
    tool: { name: 'Write', ...tool },
  }) as never

test('游戏测试角色新建 .lua 拦下，改已有的不拦', () => {
  assert.ok(testLuaDeny(input('ue:ue-gametest', { kind: 'edit', input: { file_path: 'Script/Foo.lua' } }))?.deny)
  assert.equal(testLuaDeny(input('ue:ue-gametest', { kind: 'edit', input: { file_path: 'Old.lua' } })), undefined)
})

test('别的角色只拦测试样子的：GameTestApi 目录、文件名带 Test', () => {
  assert.ok(testLuaDeny(input('developer', { kind: 'edit', input: { file_path: 'Script/GameTestApi/Bag.lua' } }))?.deny)
  assert.ok(testLuaDeny(input('developer', { kind: 'edit', input: { file_path: 'Script/BagTestApi.lua' } }))?.deny)
  assert.equal(testLuaDeny(input('developer', { kind: 'edit', input: { file_path: 'Script/Bag.lua' } })), undefined)
})

test('补丁的 Add File、命令行重定向也认', () => {
  assert.deepEqual(luaTargets(input('x', { kind: 'edit', input: { input: '*** Begin Patch\n*** Add File: a/BTest.lua\n+x' } })), [
    'a/BTest.lua',
  ])
  assert.deepEqual(luaTargets(input('x', { kind: 'shell', input: { command: 'cat > Script/QTest.lua <<EOF' } })), [
    'Script/QTest.lua',
  ])
})
