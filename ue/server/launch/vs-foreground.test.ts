// VS 调试状态算不算「前台编辑器要起来了」：编译、等着启动、在调试别的进程都算，附加的是后台编辑器本身不算。
// 用法：node --test ue/server/launch/bg-guard.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { setCtx } from '../util.ts'
import { vsForegroundWhy } from './vs-foreground.ts'

setCtx({
  t: (zh: string, vars?: Record<string, string | number>) =>
    zh.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
} as unknown as PluginServerContext)

test('VS 空闲时不挡', () => {
  assert.equal(vsForegroundWhy(undefined), undefined)
  assert.equal(vsForegroundWhy({ mode: 'design', building: false }), undefined)
})

test('VS 编译或等着启动时算前台', () => {
  assert.ok(vsForegroundWhy({ mode: 'design', building: true }))
  assert.ok(vsForegroundWhy({ mode: 'design', building: false, launchPending: true }))
})

test('VS 在调试进程时算前台，附加的是后台编辑器本身时不算', () => {
  const st = { mode: 'run' as const, building: false, processes: [{ pid: 42, name: 'UnrealEditor-Cmd.exe' }] }
  assert.ok(vsForegroundWhy(st))
  assert.equal(vsForegroundWhy(st, 42), undefined)
})
