// 假的飞书开放接口（单测和云端实测用，云端没有飞书账号）：路径和回包形状照官方 SDK（oapi-sdk-go v3）的模型，
// 成功 {code:0, msg:'success', data}，令牌过期 {code:99991677}，续期接口回平铺的 {access_token, refresh_token, expires_in}。
// 有效令牌是 u-good（续期后 u-good2）；refresh_token 是 r-good（续期后 r-good2）。calls 记下每次请求，测试按它核对
import { createServer } from 'node:http'

const HOST = 'https://example.feishu.cn'

export async function startFakeOpenApi() {
  const db = {
    docs: {
      doxcnReqAAAAAAAAAAAAAA: {
        title: '需求文档 A',
        text: `需求文档 A\n背景：登录改版。\n接口见 ${HOST}/docx/doxcnApiBBBBBBBBBBBBBB\n`,
      },
      doxcnApiBBBBBBBBBBBBBB: { title: '接口说明 B', text: '接口说明 B\nPOST /login\n' },
    },
    wiki: {
      wikcnNodeWWWWWWWWWWWWW: {
        space_id: '7000000000000000001',
        obj_token: 'doxcnReqAAAAAAAAAAAAAA',
        obj_type: 'docx',
        title: '需求文档 A',
      },
    },
    sheets: {
      shtcnPlanSSSSSSSSSSSSS: {
        title: '排期表',
        sheets: [{ sheet_id: 'a1b2c3', title: 'Sheet1' }],
        values: [
          ['模块', '负责人'],
          ['登录', '张三'],
        ],
      },
    },
    bases: {
      bascnBugsBBBBBBBBBBBBB: { title: '缺陷单', records: [{ record_id: 'rec001', fields: { 标题: '登录失败' } }] },
    },
    comments: {},
  }
  const state = { access: new Set(['u-good']), refresh: 'r-good', calls: [] }
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }
  const ok = (res, data) => send(res, 200, { code: 0, msg: 'success', data })
  const bad = (res, code, msg, status = 400) => send(res, status, { code, msg })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    let body = ''
    for await (const c of req) body += c
    const json = body ? JSON.parse(body) : undefined
    const p = url.pathname
    const auth = String(req.headers.authorization ?? '').replace(/^Bearer /, '')
    state.calls.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams), body: json, auth })

    if (p === '/open-apis/authen/v2/oauth/token') {
      if (
        json?.grant_type !== 'refresh_token' ||
        json.refresh_token !== state.refresh ||
        !json.client_id ||
        !json.client_secret
      )
        return send(res, 400, { code: 20064, error: 'invalid_grant', error_description: 'refresh token invalid' })
      state.access.add('u-good2')
      state.refresh = 'r-good2'
      return send(res, 200, {
        code: 0,
        access_token: 'u-good2',
        expires_in: 7200,
        refresh_token: 'r-good2',
        refresh_token_expires_in: 604800,
        token_type: 'Bearer',
      })
    }
    if (!state.access.has(auth)) return bad(res, 99991677, 'Authentication token expired', 401)

    let m
    if (p === '/open-apis/authen/v1/user_info') return ok(res, { name: '测试用户', open_id: 'ou_x' })
    if ((m = p.match(/^\/open-apis\/docx\/v1\/documents\/(\w+)\/raw_content$/))) {
      const d = db.docs[m[1]]
      return d ? ok(res, { content: d.text }) : bad(res, 1770002, 'not found', 404)
    }
    if (p === '/open-apis/drive/v1/metas/batch_query') {
      const r = json.request_docs[0]
      const hit = db.docs[r.doc_token]
        ? { t: 'docx', title: db.docs[r.doc_token].title, seg: 'docx' }
        : db.sheets[r.doc_token]
          ? { t: 'sheet', title: db.sheets[r.doc_token].title, seg: 'sheets' }
          : db.bases[r.doc_token]
            ? { t: 'bitable', title: db.bases[r.doc_token].title, seg: 'base' }
            : null
      if (!hit) return ok(res, { metas: [], failed_list: [{ token: r.doc_token, code: 970005 }] })
      return ok(res, {
        metas: [
          { doc_token: r.doc_token, doc_type: hit.t, title: hit.title, url: `${HOST}/${hit.seg}/${r.doc_token}` },
        ],
      })
    }
    if (p === '/open-apis/wiki/v2/spaces/get_node') {
      const n = db.wiki[url.searchParams.get('token')]
      return n
        ? ok(res, { node: { ...n, node_token: url.searchParams.get('token'), has_child: true } })
        : bad(res, 131005, 'not found', 404)
    }
    if (p === '/open-apis/search/v2/doc_wiki/search')
      return ok(res, {
        total: 1,
        has_more: false,
        res_units: Object.entries(db.docs)
          .filter(([, d]) => d.title.includes(json.query))
          .map(([tk, d]) => ({
            title_highlighted: `<h>${d.title}</h>`,
            entity_type: 'DOC',
            result_meta: { doc_types: 'DOCX', url: `${HOST}/docx/${tk}`, token: tk },
          })),
      })
    if ((m = p.match(/^\/open-apis\/sheets\/v3\/spreadsheets\/(\w+)\/sheets\/query$/)))
      return ok(res, {
        sheets: db.sheets[m[1]].sheets.map((s) => ({ ...s, grid_properties: { row_count: 200, column_count: 20 } })),
      })
    if ((m = p.match(/^\/open-apis\/sheets\/v3\/spreadsheets\/(\w+)$/)))
      return ok(res, { spreadsheet: { title: db.sheets[m[1]].title } })
    if ((m = p.match(/^\/open-apis\/sheets\/v2\/spreadsheets\/(\w+)\/values\/(.+)$/)))
      return ok(res, { valueRange: { range: decodeURIComponent(m[2]), values: db.sheets[m[1]].values } })
    if ((m = p.match(/^\/open-apis\/sheets\/v2\/spreadsheets\/(\w+)\/values$/)) && req.method === 'PUT') {
      db.sheets[m[1]].values.push(...json.valueRange.values)
      return ok(res, { revision: 2, spreadsheetToken: m[1], updatedRange: json.valueRange.range, updatedCells: 4 })
    }
    if ((m = p.match(/^\/open-apis\/bitable\/v1\/apps\/(\w+)\/tables\/(\w+)\/records$/)) && req.method === 'POST') {
      const b = db.bases[m[1]]
      const rec = { record_id: `rec00${b.records.length + 1}`, fields: json.fields }
      b.records.push(rec)
      return ok(res, { record: rec })
    }
    if ((m = p.match(/^\/open-apis\/drive\/v1\/files\/(\w+)\/comments$/)) && req.method === 'POST') {
      ;(db.comments[m[1]] ??= []).push(json)
      return ok(res, { comment_id: 'c1' })
    }
    return bad(res, 404, `fake openapi: 不认识的接口 ${req.method} ${p}`, 404)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}`, state, db, close: () => new Promise((r) => server.close(r)) }
}
