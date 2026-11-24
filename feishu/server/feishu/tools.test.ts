/**
 * 飞书工具端到端：用假的 lark-cli（test/fake-lark-cli.mjs）走完权限闸 → 调 CLI → 整理结果 → 审计。
 * 重点核对设计稿第 4 节的规则：只放行用户亲口贴的链接、引用和越界的要弹卡、写入每次弹卡、子对话只继承读、
 * 拒绝后不调 CLI、输入类参数不让 @ 读本机文件
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { McpCallContext, PluginConfirm, PluginConfirmResult } from '../plugins/sdk.ts'
import { AuditLog } from './audit.ts'
import { GrantStore } from './grants.ts'
import { clearResolveCache } from './resolve.ts'
import type { GateConfig } from './gate.ts'
import { feishuTools } from './tools.ts'

const dir = mkdtempSync(path.join(tmpdir(), 'feishu-test-'))
const log = path.join(dir, 'calls.jsonl')
process.env.FAKE_LARK_LOG = log
process.env.FAKE_LARK_STATE = path.join(dir, 'state.json')
const bin = path.resolve('test/fake-lark-cli.mjs')
const HOST = 'https://example.feishu.cn'
const A = `${HOST}/docx/doxcnReqAAAAAAAAAAAAAA`

let cfg: GateConfig = { refAsk: true, discover: 'ask', trustedSpaces: [] }
const grants = new GrantStore(path.join(dir, 'grants'))
const audit = new AuditLog(path.join(dir, 'audit'))
const tools = feishuTools(() => ({
  resolver: { bin: () => bin, cwd: () => dir },
  grants,
  audit,
  config: () => cfg,
  cacheDir: (id) => path.join(dir, 'cache', id),
}))
const tool = (name: string) => tools.find((x) => x.name === name)!

/** 一个对话：用户说过的话 + 卡片怎么答（按顺序），记下弹过的卡 */
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
    const r = await tool(name).call(args, ctx)
    const text = (r.content?.[0] as { text: string }).text
    return { isError: !!r.isError, body: JSON.parse(text) as Record<string, any> }
  }
  return { ctx, cards, call }
}
const calls = () =>
  readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { args: string[]; stdin: string })
const reset = () => {
  writeFileSync(log, '')
  rmSync(process.env.FAKE_LARK_STATE!, { force: true })
  clearResolveCache()
  cfg = { refAsk: true, discover: 'ask', trustedSpaces: [] }
}

test.after(() => rmSync(dir, { recursive: true, force: true }))

test('用户贴过的链接直接读，不弹卡；固定 --as user', async () => {
  reset()
  const c = chat('t-link', [`帮我看看 ${A}`])
  const r = await c.call('feishu_doc', { action: 'fetch', doc: A })
  assert.equal(r.isError, false, JSON.stringify(r.body))
  assert.match(r.body.content, /登录改版/)
  assert.equal(r.body.title, '需求文档 A')
  assert.equal(r.body.refs, 2)
  assert.equal(c.cards.length, 0)
  const fetch = calls().find((x) => x.args[1] === '+fetch')!
  assert.deepEqual(fetch.args.slice(-2), ['--as', 'user'])
})

test('wiki 链接解开后和文档 token 是同一篇：贴 wiki 链接也能读对应文档', async () => {
  reset()
  const c = chat('t-wiki', [`${HOST}/wiki/wikcnNodeWWWWWWWWWWWWW`])
  const r = await c.call('feishu_doc', { action: 'fetch', doc: 'doxcnReqAAAAAAAAAAAAAA' })
  assert.equal(r.isError, false, JSON.stringify(r.body))
  assert.equal(c.cards.length, 0)
})

test('文档里引用的要弹卡，卡上写出处；拒绝后不调 CLI 读正文', async () => {
  reset()
  const c = chat('t-ref', [A], [{ allow: false }])
  await c.call('feishu_doc', { action: 'fetch', doc: A })
  writeFileSync(log, '')
  const r = await c.call('feishu_doc', { action: 'fetch', doc: 'doxcnApiBBBBBBBBBBBBBB', reason: '看接口' })
  assert.equal(r.isError, true)
  assert.equal(r.body.error, 'permission_denied')
  assert.equal(c.cards.length, 1)
  assert.match(c.cards[0].title, /接口说明 B/)
  assert.match(c.cards[0].detail ?? '', /需求文档 A.*引用/)
  assert.match(c.cards[0].detail ?? '', /Agent 说的理由：看接口/)
  assert.equal(c.cards[0].rule, 'doc-read:doxcnApiBBBBBBBBBBBBBB')
  assert.equal(calls().filter((x) => x.args[1] === '+fetch').length, 0, '拒绝后不该读正文')
})

test('允许一次下次还问；这个对话一直允许后不再问', async () => {
  reset()
  const c = chat('t-once', [A], [{ allow: true }, { allow: true, always: true }])
  await c.call('feishu_doc', { action: 'fetch', doc: A })
  const B = { action: 'fetch', doc: 'doxcnApiBBBBBBBBBBBBBB' }
  assert.equal((await c.call('feishu_doc', B)).isError, false)
  assert.equal((await c.call('feishu_doc', B)).isError, false)
  assert.equal((await c.call('feishu_doc', B)).isError, false)
  assert.equal(c.cards.length, 2)
})

test('越界的（用户没给、也不是引用）卡上写明不在范围内', async () => {
  reset()
  const c = chat('t-out', [A])
  const r = await c.call('feishu_doc', { action: 'fetch', doc: `${HOST}/docx/doxcnPayCCCCCCCCCCCCCC` })
  assert.equal(r.body.error, 'permission_denied')
  // 没读过 A，C 不算引用
  assert.match(c.cards[0].detail ?? '', /不在你给的链接范围内/)
})

test('Agent 回复、文档内容里的链接不算用户给的', async () => {
  reset()
  // 用户只说了句话，没贴链接；文档 A 里写了 C 的链接
  const c = chat('t-noseed', ['帮我总结一下需求'])
  const r = await c.call('feishu_doc', { action: 'fetch', doc: A })
  assert.equal(r.body.error, 'permission_denied')
  assert.equal(c.cards.length, 1)
})

test('不在对话里（没有 confirm）一律拒绝并说清原因', async () => {
  reset()
  const r = await tool('feishu_doc').call({ action: 'fetch', doc: A }, { taskId: 't-bg', callId: 'x' })
  assert.equal(r.isError, true)
  assert.match((r.content[0] as { text: string }).text, /不在对话里/)
})

test('写入每次弹卡带差异；内容走 stdin，@ 开头不会读本机文件', async () => {
  reset()
  const c = chat('t-write', [A], [{ allow: true }])
  const r = await c.call('feishu_doc', { action: 'update', doc: A, command: 'append', content: '@/etc/passwd' })
  assert.equal(r.isError, false, JSON.stringify(r.body))
  assert.equal(c.cards.length, 1)
  assert.equal(c.cards[0].rule, 'doc-write:doxcnReqAAAAAAAAAAAAAA')
  assert.ok(c.cards[0].diff?.includes('@/etc/passwd'))
  const up = calls().find((x) => x.args[1] === '+update')!
  assert.equal(up.args[up.args.indexOf('--content') + 1], '-')
  assert.equal(up.stdin, '@/etc/passwd')
  // 只允许了一次：下次写还问
  await c.call('feishu_doc', { action: 'update', doc: A, command: 'append', content: 'x' })
  assert.equal(c.cards.length, 2)
})

test('新建的文档进读写名单：之后读写都不再问', async () => {
  reset()
  const c = chat('t-create', [], [{ allow: true }])
  const r = await c.call('feishu_doc', { action: 'create', title: '周报', content: '# 本周' })
  assert.equal(r.isError, false, JSON.stringify(r.body))
  const url = r.body.created.url as string
  assert.equal((await c.call('feishu_doc', { action: 'fetch', doc: url })).isError, false)
  assert.equal(
    (await c.call('feishu_doc', { action: 'update', doc: url, command: 'append', content: 'x' })).isError,
    false,
  )
  assert.equal(c.cards.length, 1)
})

test('子对话继承读，不继承写', async () => {
  reset()
  const parent = chat('t-parent', [A], [{ allow: true, always: true }])
  await parent.call('feishu_doc', { action: 'fetch', doc: A })
  await parent.call('feishu_doc', { action: 'update', doc: A, command: 'append', content: 'p' })
  await grants.setParent('t-child', 't-parent')
  const child = chat('t-child', [], [{ allow: false }])
  assert.equal((await child.call('feishu_doc', { action: 'fetch', doc: A })).isError, false)
  assert.equal(child.cards.length, 0)
  const w = await child.call('feishu_doc', { action: 'update', doc: A, command: 'append', content: 'c' })
  assert.equal(w.body.error, 'permission_denied')
  assert.equal(child.cards.length, 1)
})

test('搜索每次弹卡；设置成一律不许时不弹卡直接拒绝', async () => {
  reset()
  const c = chat('t-search', [], [{ allow: true }])
  const r = await c.call('feishu_search', { action: 'docs', query: '登录' })
  assert.equal(r.isError, false, JSON.stringify(r.body))
  assert.equal(c.cards[0].rule, 'discover:feishu_search.docs')
  assert.match(r.body.note, /没有自动授权/)
  cfg = { ...cfg, discover: 'deny' }
  const d = await c.call('feishu_search', { action: 'docs', query: '登录' })
  assert.equal(d.body.error, 'permission_denied')
  assert.equal(c.cards.length, 1)
})

test('信任的知识库空间里的文档读取不弹卡', async () => {
  reset()
  cfg = { ...cfg, trustedSpaces: ['7000000000000000001'] }
  const c = chat('t-trust', [])
  assert.equal(
    (await c.call('feishu_doc', { action: 'fetch', doc: `${HOST}/wiki/wikcnNodeWWWWWWWWWWWWW` })).isError,
    false,
  )
  assert.equal(c.cards.length, 0)
})

test('类型不对、参数拼错、action 不对都直接报错，不调 CLI 读内容', async () => {
  reset()
  const c = chat('t-bad', [`${HOST}/sheets/shtcnPlanSSSSSSSSSSSSS`])
  const wrong = await c.call('feishu_doc', { action: 'fetch', doc: `${HOST}/sheets/shtcnPlanSSSSSSSSSSSSS` })
  assert.equal(wrong.body.error, 'invalid_argument')
  assert.match(wrong.body.message, /feishu_sheet/)
  assert.equal((await c.call('feishu_doc', { action: 'fetch', doc: A, dco: 1 })).body.error, 'invalid_argument')
  assert.equal((await c.call('feishu_doc', { action: 'delete', doc: A })).body.error, 'invalid_argument')
  assert.equal((await c.call('feishu_doc', { action: 'fetch', doc: 'not a link!' })).body.error, 'invalid_argument')
  assert.equal(calls().filter((x) => x.args[1] === '+fetch').length, 0)
})

test('表格按用户给的链接读；Markdown 替换的 pattern 以 @ 开头时转义', async () => {
  reset()
  const S = `${HOST}/sheets/shtcnPlanSSSSSSSSSSSSS`
  const c = chat('t-sheet', [S, `${HOST}/file/boxcnMdFFFFFFFFFFFFFFF`], [{ allow: true }])
  const r = await c.call('feishu_sheet', { action: 'read', sheet: S })
  assert.equal(r.isError, false, JSON.stringify(r.body))
  const p = await c.call('feishu_markdown', {
    action: 'patch',
    file: `${HOST}/file/boxcnMdFFFFFFFFFFFFFFF`,
    pattern: '@旧的一行',
    content: '新的',
  })
  assert.equal(p.isError, false, JSON.stringify(p.body))
  const patch = calls().find((x) => x.args[1] === '+patch')!
  assert.equal(patch.args[patch.args.indexOf('--pattern') + 1], '@@旧的一行')
})

test('审计日志记下每次调用（不记内容）', async () => {
  const rows = await audit.list({ limit: 500 })
  const items = (rows as { items?: unknown[] }).items ?? (rows as unknown[])
  assert.ok(items.length > 10)
  assert.ok(!JSON.stringify(items).includes('登录改版'), '审计里不该有文档内容')
})
