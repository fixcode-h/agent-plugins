#!/usr/bin/env node
// 假的 lark-cli（单测和云端演示用，云端没有飞书账号）：按官方 JSON 信封返回，内置几篇假文档。
// - 成功：stdout {"ok":true,"identity":"user","data":…}，退出码 0；失败：stderr {"ok":false,"error":{…}}，退出码 1
// - FAKE_LARK_LOG：每次调用追加一行 {args, stdin}，测试按它核对「到底调了 lark-cli 什么」
// - FAKE_LARK_STATE：文档的改动存这里（update / create / 写表格），不设就只在本次进程里
// 数据形状照 lark-cli 1.0.100 源码（drive +inspect 的 type/title/token/url/wiki_node，docs +fetch 的 document.content）
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const stdin = await new Promise((resolve) => {
  if (process.stdin.isTTY) return resolve('')
  let s = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => (s += c))
  process.stdin.on('end', () => resolve(s))
  setTimeout(() => resolve(s), 500)
})
if (process.env.FAKE_LARK_LOG) appendFileSync(process.env.FAKE_LARK_LOG, JSON.stringify({ args: argv, stdin }) + '\n')

const HOST = 'https://example.feishu.cn'
const SEED = {
  docs: {
    doxcnReqAAAAAAAAAAAAAA: {
      title: '需求文档 A',
      content:
        '<title>需求文档 A</title>\n<h1>背景</h1><p>登录改版。</p>\n<h1>接口</h1><p>见 <cite type="doc" doc-id="doxcnApiBBBBBBBBBBBBBB" file-type="docx" title="接口说明 B"></cite>，薪酬口径见 ' +
        HOST +
        '/docx/doxcnPayCCCCCCCCCCCCCC 。</p>',
    },
    doxcnApiBBBBBBBBBBBBBB: { title: '接口说明 B', content: '<title>接口说明 B</title><p>POST /login</p>' },
    doxcnPayCCCCCCCCCCCCCC: { title: '内部薪酬 C', content: '<title>内部薪酬 C</title><p>机密</p>' },
  },
  wiki: {
    wikcnNodeWWWWWWWWWWWWW: { space_id: '7000000000000000001', obj_token: 'doxcnReqAAAAAAAAAAAAAA', obj_type: 'docx' },
  },
  sheets: { shtcnPlanSSSSSSSSSSSSS: { title: '排期表', csv: '模块,负责人\n登录,张三\n' } },
  bases: {
    bascnBugsBBBBBBBBBBBBB: { title: '缺陷单', records: [{ record_id: 'rec001', fields: { 标题: '登录失败' } }] },
  },
  files: { boxcnMdFFFFFFFFFFFFFFF: { title: 'notes.md', content: '# 笔记\n旧的一行\n' } },
  minutes: { obcnMinuteMMMMMMMMMMMM: { title: '周会', summary: '定了登录改版' } },
  comments: {},
}

const statePath = process.env.FAKE_LARK_STATE
const db = statePath && existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : structuredClone(SEED)
const save = () => statePath && writeFileSync(statePath, JSON.stringify(db))

const ok = (data) => {
  process.stdout.write(JSON.stringify({ ok: true, identity: 'user', data }) + '\n')
  process.exit(0)
}
const fail = (message, type = 'api', code = 1254040) => {
  process.stderr.write(JSON.stringify({ ok: false, identity: 'user', error: { type, code, message, hint: '' } }) + '\n')
  process.exit(1)
}
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return undefined
  const v = argv[i + 1]
  return v === '-' ? stdin : v
}
const has = (name) => argv.includes(`--${name}`)
const tokenOf = (s) => (s ?? '').match(/([A-Za-z0-9]{8,})(?:[?#].*)?$/)?.[1] ?? ''

if (argv[0] === '--version') {
  process.stdout.write('lark-cli version 1.0.100-fake\n')
  process.exit(0)
}
const [svc, cmd] = argv
const key = `${svc} ${cmd}`

function inspect(input, type) {
  const tk = tokenOf(input)
  const kind = /\/wiki\//.test(input) || type === 'wiki' ? 'wiki' : null
  if (kind === 'wiki' || db.wiki[tk]) {
    const n = db.wiki[tk]
    if (!n) return fail('wiki node not found or no permission')
    const doc = db.docs[n.obj_token]
    return {
      input_url: input,
      type: n.obj_type,
      title: doc?.title ?? '',
      token: n.obj_token,
      url: `${HOST}/docx/${n.obj_token}`,
      wiki_node: { space_id: n.space_id, node_token: tk, obj_token: n.obj_token, obj_type: n.obj_type },
    }
  }
  if (db.docs[tk])
    return { input_url: input, type: 'docx', title: db.docs[tk].title, token: tk, url: `${HOST}/docx/${tk}` }
  if (db.sheets[tk])
    return { input_url: input, type: 'sheet', title: db.sheets[tk].title, token: tk, url: `${HOST}/sheets/${tk}` }
  if (db.bases[tk])
    return { input_url: input, type: 'bitable', title: db.bases[tk].title, token: tk, url: `${HOST}/base/${tk}` }
  if (db.files[tk])
    return { input_url: input, type: 'file', title: db.files[tk].title, token: tk, url: `${HOST}/file/${tk}` }
  if (/^fld/.test(tk))
    return { input_url: input, type: 'folder', title: '项目文件夹', token: tk, url: `${HOST}/drive/folder/${tk}` }
  return fail('resource not found or no permission (99991672)')
}

const doc = (input) => db.docs[tokenOf(input)] ?? fail('document not found or no permission')

switch (key) {
  case 'auth status':
    ok({ logged_in: true, user: 'fake-user', identity: 'user' })
    break
  case 'drive +inspect':
    ok(inspect(flag('url'), flag('type')))
    break
  case 'docs +fetch': {
    const d = doc(flag('doc'))
    let content = d.content
    if (flag('scope') === 'outline') content = (d.content.match(/<h1>[^<]*<\/h1>/g) ?? []).join('\n')
    ok({ document: { title: d.title, content } })
    break
  }
  case 'docs +update': {
    const d = doc(flag('doc'))
    const c = flag('command')
    const content = flag('content') ?? ''
    if (c === 'append') d.content += content
    else if (c === 'overwrite') d.content = content
    else if (c === 'str_replace') d.content = d.content.replace(flag('pattern') ?? '', content)
    save()
    ok({ document_id: tokenOf(flag('doc')), revision_id: 2 })
    break
  }
  case 'docs +create': {
    const tk = `doxcnNew${Date.now().toString(36).toUpperCase().padStart(14, 'N')}`
    db.docs[tk] = { title: flag('title') ?? '未命名', content: flag('content') ?? '' }
    save()
    ok({ document: { document_id: tk, url: `${HOST}/docx/${tk}` } })
    break
  }
  case 'docs +media-download':
    writeFileSync(flag('output'), 'fake-image')
    ok({ saved_path: flag('output') })
    break
  case 'drive +search':
    ok({
      items: Object.entries(db.docs)
        .filter(([, d]) => d.title.includes(flag('query') ?? '') || d.content.includes(flag('query') ?? ''))
        .map(([tk, d]) => ({ title: d.title, type: 'docx', url: `${HOST}/docx/${tk}` })),
    })
    break
  case 'wiki +node-get': {
    const n = db.wiki[tokenOf(flag('node-token'))] ?? fail('node not found')
    ok({ node: { ...n, title: db.docs[n.obj_token]?.title, has_child: true } })
    break
  }
  case 'wiki +node-list':
    ok({ items: [{ node_token: 'wikcnChildXXXXXXXXXXX', title: '子页面 X', obj_type: 'docx' }] })
    break
  case 'wiki +space-list':
    ok({ items: [{ space_id: '7000000000000000001', name: '产品知识库' }] })
    break
  case 'drive +list-comments':
    ok({ items: db.comments[tokenOf(flag('url'))] ?? [] })
    break
  case 'drive +add-comment': {
    const tk = tokenOf(flag('doc'))
    const list = (db.comments[tk] ??= [])
    list.push({ comment_id: `c${list.length + 1}`, content: JSON.parse(flag('content') ?? '[]') })
    save()
    ok({ comment_id: `c${list.length}` })
    break
  }
  case 'drive +add-reply':
  case 'drive +resolve-comment':
    ok({ comment_id: flag('comment-id') })
    break
  case 'sheets +workbook-info': {
    const s = db.sheets[tokenOf(flag('url'))] ?? fail('sheet not found')
    ok({ title: s.title, sheets: [{ sheet_id: 'a1b2c3', title: 'Sheet1', rows: 3, cols: 2 }] })
    break
  }
  case 'sheets +csv-get':
    ok({ csv: (db.sheets[tokenOf(flag('url'))] ?? fail('sheet not found')).csv })
    break
  case 'sheets +cells-search':
    ok({ matches: [{ cell: 'A2', value: flag('find') }] })
    break
  case 'sheets +csv-put': {
    const s = db.sheets[tokenOf(flag('url'))] ?? fail('sheet not found')
    s.csv += flag('csv') ?? ''
    save()
    ok({ updated_cells: 2 })
    break
  }
  case 'base +table-list':
    ok({ tables: [{ table_id: 'tblBugs', name: '缺陷' }] })
    break
  case 'base +field-list':
    ok({ fields: [{ field_id: 'fld1', name: '标题', type: 'text' }] })
    break
  case 'base +record-list':
  case 'base +record-search':
  case 'base +record-get':
    ok({ records: (db.bases[flag('base-token')] ?? fail('base not found')).records })
    break
  case 'base +record-upsert': {
    const b = db.bases[flag('base-token')] ?? fail('base not found')
    b.records.push({ record_id: `rec00${b.records.length + 1}`, fields: JSON.parse(flag('json') ?? '{}') })
    save()
    ok({ record_id: `rec00${b.records.length}` })
    break
  }
  case 'markdown +fetch':
    ok({ content: (db.files[flag('file-token')] ?? fail('file not found')).content })
    break
  case 'markdown +patch':
  case 'markdown +overwrite': {
    const f = db.files[flag('file-token')] ?? fail('file not found')
    f.content =
      cmd === '+patch' ? f.content.replace(flag('pattern') ?? '', flag('content') ?? '') : (flag('content') ?? '')
    save()
    ok({ file_token: flag('file-token') })
    break
  }
  case 'minutes +search':
    ok({ items: Object.entries(db.minutes).map(([tk, m]) => ({ minute_token: tk, title: m.title })) })
    break
  case 'minutes +detail': {
    const m = db.minutes[flag('minute-tokens')] ?? fail('minute not found')
    ok({ minutes: [{ title: m.title, summary: m.summary }] })
    break
  }
  default:
    fail(`fake lark-cli: 不认识的命令 ${key}`, 'validation')
}
void has
