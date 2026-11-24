/** 飞书登录搬到账号授权：1.1.0 填在插件里的 token 搬过去且只搬一次；lark-cli 的位置用账号授权检测到的 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { PluginServerContext } from '../../../sdk/server.ts'
import { locateViaIntegration, migrateLogin } from './login.ts'

const dir = mkdtempSync(path.join(tmpdir(), 'feishu-login-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

const store = (init: Record<string, string> = {}) => {
  const m: Partial<Record<string, string>> = { ...init }
  return {
    m,
    s: {
      get: async (k: string) => m[k] ?? '',
      set: async (k: string, v: string) => void (v ? (m[k] = v) : delete m[k]),
    },
  }
}

function fakeCtx(sub: string, state?: { installed: boolean; authed: boolean; path: string }) {
  const plugin = store({ userToken: 'u-old-token-1234', appSecret: 'sec-old' })
  const integ = store({ appSecret: 'sec-already-there' })
  const ctx = {
    dataDir: path.join(dir, sub),
    secrets: plugin.s,
    log: { info: () => {}, warn: () => {} },
    integrations: {
      get: async () => (state ? { ...state, account: 'demo', version: 'lark-cli version 1.0.100' } : undefined),
      credentials: () => integ.s,
    },
  } as unknown as PluginServerContext
  return { ctx, plugin: plugin.m, integ: integ.m }
}

test('1.1.0 的 token 搬进账号授权：已有的不覆盖，插件里的清掉，只搬一次', async () => {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(path.join(dir, 'a'), { recursive: true })
  const { ctx, plugin, integ } = fakeCtx('a')
  await migrateLogin(ctx, async () => ({ appId: 'cli_old', brand: 'lark' }))
  assert.deepEqual(integ, {
    userToken: 'u-old-token-1234',
    appSecret: 'sec-already-there',
    appId: 'cli_old',
    brand: 'lark',
  })
  assert.deepEqual(plugin, {}, '插件里的保密项搬完清掉')
  // 用户之后在账号授权里清空了，再启动也不搬回来
  Reflect.deleteProperty(integ, 'userToken')
  plugin.userToken = 'u-again'
  await migrateLogin(ctx, async () => ({}))
  assert.equal(integ.userToken, undefined)
})

test('lark-cli 用账号授权检测到的路径；落在拦截垫片目录里的不认', async () => {
  const shim = path.join(dir, 'bin')
  const ok = fakeCtx('b', { installed: true, authed: true, path: '/usr/local/bin/lark-cli' })
  assert.deepEqual(await locateViaIntegration(ok.ctx, '', shim), {
    path: '/usr/local/bin/lark-cli',
    from: 'integration',
    authed: true,
    account: 'demo',
    version: 'lark-cli version 1.0.100',
  })
  const shimmed = fakeCtx('c', { installed: true, authed: true, path: path.join(shim, 'lark-cli') })
  assert.notEqual((await locateViaIntegration(shimmed.ctx, '', shim))?.from, 'integration')
})
