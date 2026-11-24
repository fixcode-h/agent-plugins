/** 找 lark-cli：跳过插件自己的拦截垫片、设置里填的优先、找不到时工具报 cli_unavailable 并写清怎么装 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AuditLog } from './audit.ts'
import { GrantStore } from './grants.ts'
import { locateLark } from './locate.ts'
import { clearResolveCache } from './resolve.ts'
import { feishuTools } from './tools.ts'

const isWin = process.platform === 'win32'
const root = mkdtempSync(path.join(tmpdir(), 'feishu-locate-'))
const make = (dir: string) => {
  mkdirSync(dir, { recursive: true })
  const f = path.join(dir, isWin ? 'lark-cli.cmd' : 'lark-cli')
  writeFileSync(f, isWin ? '@echo off\r\n' : '#!/bin/sh\n')
  chmodSync(f, 0o755)
  return f
}
const shim = path.join(root, 'plugin', 'bin')
const real = path.join(root, 'npm-global')
make(shim)
const realFile = make(real)
const oldPath = process.env.PATH
test.after(() => {
  process.env.PATH = oldPath
  rmSync(root, { recursive: true, force: true })
})

test('PATH 里插件的垫片排在前面也跳过它，找到真的 lark-cli', async () => {
  process.env.PATH = [shim, real, oldPath].join(path.delimiter)
  assert.deepEqual(await locateLark('', shim, true), { path: realFile, from: 'path' })
})

test('设置里填了完整路径就用填的', async () => {
  assert.deepEqual(await locateLark(realFile, shim, true), { path: realFile, from: 'config' })
  assert.equal(await locateLark(path.join(root, 'nope', 'lark-cli'), shim, true), undefined)
})

test('找不到 lark-cli：工具返回 cli_unavailable，写清怎么装，不弹卡', async () => {
  clearResolveCache()
  const tools = feishuTools(() => ({
    resolver: { bin: async () => '', cwd: () => root },
    grants: new GrantStore(path.join(root, 'grants')),
    audit: new AuditLog(path.join(root, 'audit')),
    config: () => ({ refAsk: true, discover: 'ask', trustedSpaces: [] }),
    cacheDir: (id) => path.join(root, 'cache', id),
  }))
  let cards = 0
  const r = await tools
    .find((x) => x.name === 'feishu_doc')!
    .call(
      { action: 'fetch', doc: 'https://a.feishu.cn/wiki/C2GwwIgXWiSAK9k11iwcATU7n4d' },
      { taskId: 't', callId: 'c', confirm: async () => (cards++, { allow: true, message: '' }) },
    )
  const body = JSON.parse((r.content[0] as { text: string }).text)
  assert.equal(r.isError, true)
  assert.equal(body.error, 'cli_unavailable')
  assert.match(body.message, /npm install -g @larksuite\/cli/)
  assert.equal(cards, 0)
})
