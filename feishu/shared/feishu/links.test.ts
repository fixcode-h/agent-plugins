/** 飞书链接识别、终端命令拦截：纯函数 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { findCitedRefs, findFeishuLinks, parseFeishuUrl } from './links.ts'
import { callsLarkCli } from './shell.ts'

test('认飞书链接：各种域名和类型，别的网址不算', () => {
  assert.deepEqual(parseFeishuUrl('https://abc.feishu.cn/docx/doxcnAAAAAAAAAAAA?from=x'), {
    kind: 'docx',
    token: 'doxcnAAAAAAAAAAAA',
    url: 'https://abc.feishu.cn/docx/doxcnAAAAAAAAAAAA?from=x',
  })
  assert.equal(parseFeishuUrl('https://x.larksuite.com/wiki/wikcnBBBBBBBBBBBB')?.kind, 'wiki')
  assert.equal(parseFeishuUrl('https://x.feishu.cn/sheets/shtcnCCCCCCCCCCCC')?.kind, 'sheet')
  assert.equal(parseFeishuUrl('https://x.feishu.cn/base/bascnDDDDDDDDDDDD')?.kind, 'bitable')
  assert.equal(parseFeishuUrl('https://evil.com/docx/doxcnAAAAAAAAAAAA'), undefined)
  assert.equal(parseFeishuUrl('https://feishu.cn.evil.com/docx/doxcnAAAAAAAAAAAA'), undefined)
  assert.equal(parseFeishuUrl('javascript:alert(1)'), undefined)
})

test('从文字里找链接：去重、去掉句尾标点、中文标点断开', () => {
  const refs = findFeishuLinks(
    '看下 https://a.feishu.cn/docx/doxcnAAAAAAAAAAAA。还有（https://a.feishu.cn/wiki/wikcnBBBBBBBBBBBB）和 https://a.feishu.cn/docx/doxcnAAAAAAAAAAAA.',
  )
  assert.deepEqual(
    refs.map((r) => r.token),
    ['doxcnAAAAAAAAAAAA', 'wikcnBBBBBBBBBBBB'],
  )
})

test('文档里的引用：链接、cite、内嵌表格都认', () => {
  const refs = findCitedRefs(
    '<p>见 https://a.feishu.cn/docx/doxcnAAAAAAAAAAAA</p><cite type="doc" doc-id="doxcnBBBBBBBBBBBB" file-type="docx"></cite>' +
      '<cite type="user" token="ou_xxxxxxxxxxxx"></cite><sheet token="shtcnCCCCCCCCCCCC"></sheet><bitable token="bascnDDDDDDDDDDDD"/>',
  )
  assert.deepEqual(
    refs.map((r) => `${r.kind}:${r.token}`),
    ['docx:doxcnAAAAAAAAAAAA', 'docx:doxcnBBBBBBBBBBBB', 'sheet:shtcnCCCCCCCCCCCC', 'bitable:bascnDDDDDDDDDDDD'],
  )
})

test('终端命令里调 lark-cli 的都拦，别的不拦', () => {
  for (const c of [
    'lark-cli docs +fetch --doc x',
    'cd a && lark-cli drive +search',
    '/usr/local/bin/lark-cli wiki +space-list',
    'npx @larksuite/cli@latest docs +fetch',
    'C:\\npm\\lark-cli.cmd docs',
    'x=$(lark-cli auth status)',
  ])
    assert.equal(callsLarkCli(c), true, c)
  for (const c of ['ls -la', 'npm run lark-cli-docs', 'echo mylark-cli', 'git log'])
    assert.equal(callsLarkCli(c), false, c)
})
