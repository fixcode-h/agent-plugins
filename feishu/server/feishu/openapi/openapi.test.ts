/**
 * token 模式（用户 2026-11-24 加「用 token 登录」）：用假的开放接口（test/fake-openapi.mjs）走完
 * 权限闸 → 开放接口 → 结果整理。核对：权限规则和 lark-cli 那条路一样、令牌过期自动续期、
 * 改文档正文这类不支持的操作不发请求、找不到 lark-cli 时自动改走 token
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { McpCallContext, PluginConfirm, PluginConfirmResult } from '../../plugins/sdk.ts'
// @ts-expect-error 测试用的假接口是 .mjs，没有类型
import { startFakeOpenApi } from '../../../test/fake-openapi.mjs'
import { AuditLog } from '../audit.ts'
import { pickRoute } from '../backend.ts'
import { GrantStore } from '../grants.ts'
import { clearResolveCache } from '../resolve.ts'
import { feishuTools } from '../tools.ts'
import { FeishuApi } from './client.ts'

const dir = mkdtempSync(path.join(tmpdir(), 'feishu-api-test-'))
const fake = await startFakeOpenApi()
test.after(async () => {
  await fake.close()
  rmSync(dir, { recursive: true, force: true })
})
const HOST = 'https://example.feishu.cn'
const A = `${HOST}/docx/doxcnReqAAAAAAAAAAAAAA`
const SHEET = `${HOST}/sheets/shtcnPlanSSSSSSSSSSSSS`

const secrets: Record<string, string> = { userToken: 'u-good' }
let expiry = 0
let appId = ''
const api = new FeishuApi({
  base: () => fake.url,
  appId: () => appId,
  secrets: { get: async (k) => secrets[k] ?? '', set: async (k, v) => void (secrets[k] = v) },
  expiry: { get: async () => expiry, set: async (at) => void (expiry = at) },
  fetch: (url, init) => fetch(url, init),
})
const tools = feishuTools(() => ({
  resolver: { bin: () => '', cwd: () => dir, mode: async () => 'api', api },
  grants: new GrantStore(path.join(dir, 'grants')),
  audit: new AuditLog(path.join(dir, 'audit')),
  config: () => ({ refAsk: true, discover: 'ask', trustedSpaces: [] }),
  cacheDir: (id) => path.join(dir, 'cache', id),
}))

function chat(taskId: string, words: string[], answers: Partial<PluginConfirmResult>[] = []) {
  const cards: PluginConfirm[] = []
  const ctx: McpCallContext = {
    taskId,
    callId: 'c1',
    userWords: () => words.map((text) => ({ text, at: '2026-11-24T00:00:00Z' })),
    confirm: async (req) => {
      cards.push(req)
      const a = answers.shift() ?? { allow: false }
      return { allow: !!a.allow, always: a.always, message: '' }
    },
  }
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await tools.find((x) => x.name === name)!.call(args, ctx)
    return { isError: !!r.isError, body: JSON.parse((r.content?.[0] as { text: string }).text) as Record<string, any> }
  }
  return { cards, call }
}
const callsTo = (re: RegExp) => fake.state.calls.filter((c: { path: string }) => re.test(c.path))

test('贴过的链接直接读：带用户令牌调 raw_content，正文原样回来，引用照样记下', async () => {
  clearResolveCache()
  const c = chat('t1', [`帮我看看 ${A}`])
  const r = await c.call('feishu_doc', { action: 'fetch', doc: A })
  assert.equal(r.isError, false, JSON.stringify(r.body))
  assert.equal(c.cards.length, 0)
  assert.equal(r.body.title, '需求文档 A')
  assert.match(r.body.content, /登录改版/)
  assert.equal(r.body.refs, 1, '正文里的飞书链接照样算引用')
  assert.equal(callsTo(/raw_content$/).at(-1).auth, 'u-good')
})

test('没贴过的文档要弹卡，拒绝后不读正文', async () => {
  const c = chat('t2', ['随便看看'], [{ allow: false }])
  const r = await c.call('feishu_doc', { action: 'fetch', doc: `${HOST}/docx/doxcnApiBBBBBBBBBBBBBB` })
  assert.equal(r.isError, true)
  assert.equal(c.cards.length, 1)
  assert.equal(c.cards[0]!.detail?.includes('接口说明 B') || c.cards[0]!.title.includes('接口说明 B'), true)
  assert.equal(callsTo(/doxcnApiBBBBBBBBBBBBBB\/raw_content$/).length, 0)
})

test('写表格：弹卡带差异，按 CSV 算出范围写进第一张表', async () => {
  const c = chat('t3', [`更新 ${SHEET}`], [{ allow: true }])
  const r = await c.call('feishu_sheet', {
    action: 'write',
    sheet: SHEET,
    csv: '支付,李四\n退款,王五\n',
    start_cell: 'A3',
  })
  assert.equal(r.isError, false, JSON.stringify(r.body))
  assert.equal(c.cards.length, 1)
  assert.match(c.cards[0]!.diff ?? '', /\+支付,李四/)
  const put = callsTo(/\/values$/).at(-1)
  assert.equal(put.method, 'PUT')
  assert.deepEqual(put.body, {
    valueRange: {
      range: 'a1b2c3!A3:B4',
      values: [
        ['支付', '李四'],
        ['退款', '王五'],
      ],
    },
  })
  const read = await c.call('feishu_sheet', { action: 'read', sheet: SHEET })
  assert.match(read.body.content, /退款,王五/)
})

test('改文档正文在 token 模式下不支持：直接说明要装 lark-cli，不弹卡、不发请求', async () => {
  const before = fake.state.calls.length
  const c = chat('t4', [`改一下 ${A}`], [{ allow: true }])
  const r = await c.call('feishu_doc', { action: 'update', doc: A, command: 'append', content: 'x' })
  assert.equal(r.isError, true)
  assert.equal(r.body.error, 'not_supported')
  assert.match(r.body.message, /lark-cli/)
  assert.equal(c.cards.length, 0, '做不了的不弹卡')
  assert.equal(fake.state.calls.length, before)
})

test('令牌过期：有 refresh_token 和应用凭据就续期一次再调，新令牌存回保密项', async () => {
  clearResolveCache()
  fake.state.access.delete('u-good')
  secrets.refreshToken = 'r-good'
  secrets.appSecret = 'sec'
  appId = 'cli_test'
  const c = chat('t5', [`看 ${A}`])
  const r = await c.call('feishu_doc', { action: 'fetch', doc: A })
  assert.equal(r.isError, false, JSON.stringify(r.body))
  assert.equal(secrets.userToken, 'u-good2')
  assert.equal(secrets.refreshToken, 'r-good2')
  assert.ok(expiry > Date.now())
  const tok = callsTo(/oauth\/token$/)
  assert.equal(tok.length, 1, '几个调用同时过期也只续一次')
  assert.equal(tok[0].body.client_id, 'cli_test')
})

test('令牌过期又不能续期：报 auth_expired，写清去哪填新令牌', async () => {
  clearResolveCache()
  secrets.userToken = 'u-dead'
  delete secrets.refreshToken
  const c = chat('t6', [`看 ${A}`])
  const r = await c.call('feishu_doc', { action: 'fetch', doc: A })
  assert.equal(r.isError, true)
  assert.match(r.body.message + (r.body.hint ?? ''), /user_access_token/)
  secrets.userToken = 'u-good2'
})

test('搜索：整理成标题、类型、链接，去掉高亮标记', async () => {
  const c = chat('t7', ['搜一下'], [{ allow: true }])
  const r = await c.call('feishu_search', { action: 'docs', query: '需求' })
  assert.equal(r.isError, false, JSON.stringify(r.body))
  assert.deepEqual(r.body.data.items[0], { title: '需求文档 A', type: 'docx', url: A, token: 'doxcnReqAAAAAAAAAAAAAA' })
})

test('选路：自动时有 lark-cli 用它，没有再看 token；只用某一种时不看另一种', async () => {
  const yes = async () => true
  const no = async () => false
  assert.equal(await pickRoute('auto', yes, yes), 'cli')
  assert.equal(await pickRoute('auto', no, yes), 'api')
  assert.equal(await pickRoute('auto', no, no), 'cli', '都没有时按 lark-cli 报没装（提示里写了两种办法）')
  assert.equal(await pickRoute('cli', no, yes), 'cli')
  assert.equal(await pickRoute('token', yes, no), 'api')
})
