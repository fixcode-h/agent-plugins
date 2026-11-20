// 世界类型统一写法（instances.ts normWorld）和名片 PID 顶替检查（proc-start.ts）在非 Windows 上不下结论
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normWorld } from '../instances.ts'
import { checkReused, knownReused } from './proc-start.ts'

const w = (type: string, netMode: string) => normWorld({ id: 'x', type, netMode, map: 'M' })

test('UELink 的小写世界类型和网络模式转成网页认的写法', () => {
  assert.deepEqual([w('editor', 'standalone').type, w('editor', 'standalone').netMode], ['Editor', 'Standalone'])
  assert.deepEqual([w('pie', 'listen').type, w('pie', 'listen').netMode], ['PIE', 'ListenServer'])
  assert.deepEqual([w('game', 'dedicated').type, w('game', 'dedicated').netMode], ['Game', 'DedicatedServer'])
  assert.equal(w('pie', 'client').netMode, 'Client')
})

test('已经是大写（假桥接）或不认识的原样留着', () => {
  assert.deepEqual([w('PIE', 'Client').type, w('PIE', 'Client').netMode], ['PIE', 'Client'])
  assert.deepEqual([w('Weird', 'x').type, w('Weird', 'x').netMode], ['Weird', 'x'])
})

test('非 Windows 或名片没有 startedAt 时不当成顶替', async () => {
  if (process.platform === 'win32') return
  assert.equal(await checkReused(process.pid, new Date().toISOString()), false)
  assert.equal(await checkReused(process.pid, undefined), false)
  assert.equal(knownReused(process.pid, undefined), false)
})
