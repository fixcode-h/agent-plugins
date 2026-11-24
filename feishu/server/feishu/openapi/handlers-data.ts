import { parseCsv, writeCsv } from '../../../shared/csv.ts'
import { t } from '../../../shared/i18n.ts'
import { list, num, raw, str } from '../ops/args.ts'
import type { LarkResult } from '../cli.ts'
import type { OpArgs, Target } from '../ops/types.ts'
import type { FeishuApi } from './client.ts'
import type { ApiHandler } from './types.ts'

/**
 * 电子表格、多维表格、云空间文件的开放接口实现（token 模式）。
 * 云空间 Markdown 文件只读（改写要分片上传整份文件，用户 2026-11-24 选了改文档正文以外的读写，这类不做）
 */

const enc = encodeURIComponent
const unsupported = (message: string): LarkResult => ({ ok: false, error: { type: 'not_supported', message } })

/** 表格里的工作表：sheet_id 优先，其次按名字找，都没给用第一张 */
async function sheetOf(api: FeishuApi, x: Target, a: OpArgs): Promise<{ id: string } | LarkResult> {
  if (str(a, 'sheet_id')) return { id: str(a, 'sheet_id') }
  const r = await api.call({ path: `/open-apis/sheets/v3/spreadsheets/${enc(x.token)}/sheets/query` })
  if (!r.ok) return r
  const sheets = ((r.data as { sheets?: { sheet_id: string; title: string }[] }).sheets ?? []).filter(Boolean)
  const name = str(a, 'sheet_name')
  const hit = name ? sheets.find((s) => s.title === name) : sheets[0]
  if (!hit)
    return unsupported(
      name
        ? t('表格里没有叫「{name}」的工作表，有：{all}', { name, all: sheets.map((s) => s.title).join('、') })
        : t('表格里没有工作表'),
    )
  return { id: hit.sheet_id }
}

/** 列号 ↔ 字母：1 → A，27 → AA */
const colName = (n: number) => {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}
const colNum = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)

/** 单元格值转成文字：公式、链接、@人这些结构取能看的文字 */
const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (typeof v !== 'object') return String(v)
  if (Array.isArray(v)) return v.map(cellText).join('')
  const o = v as Record<string, unknown>
  return String(o.text ?? o.link ?? o.name ?? JSON.stringify(v))
}

export const DATA_API: Record<string, ApiHandler> = {
  'feishu_sheet.info': async (api, _a, x) => {
    const [meta, sheets] = await Promise.all([
      api.call({ path: `/open-apis/sheets/v3/spreadsheets/${enc(x!.token)}` }),
      api.call({ path: `/open-apis/sheets/v3/spreadsheets/${enc(x!.token)}/sheets/query` }),
    ])
    if (!meta.ok) return meta
    if (!sheets.ok) return sheets
    const sp = (meta.data as { spreadsheet?: { title?: string } }).spreadsheet ?? {}
    const list = ((sheets.data as { sheets?: Record<string, unknown>[] }).sheets ?? []).map((s) => {
      const g = (s.grid_properties ?? {}) as Record<string, unknown>
      return { sheet_id: s.sheet_id, title: s.title, rows: g.row_count, cols: g.column_count }
    })
    return { ok: true, data: { title: sp.title ?? x!.title, sheets: list } }
  },
  'feishu_sheet.read': async (api, a, x) => {
    const sh = await sheetOf(api, x!, a)
    if ('ok' in sh) return sh
    const range = str(a, 'range')
    const full = range.includes('!') ? range : range ? `${sh.id}!${range}` : sh.id
    const r = await api.call({
      path: `/open-apis/sheets/v2/spreadsheets/${enc(x!.token)}/values/${enc(full)}`,
      query: { valueRenderOption: 'ToString' },
    })
    if (!r.ok) return r
    const values = ((r.data as { valueRange?: { values?: unknown[][] } }).valueRange?.values ?? []).map((row) =>
      (row ?? []).map(cellText),
    )
    return { ok: true, data: { csv: writeCsv(values, { delimiter: ',', eol: 'lf', bom: false }) } }
  },
  'feishu_sheet.find': async (api, a, x) => {
    const sh = await sheetOf(api, x!, a)
    if ('ok' in sh) return sh
    const range = str(a, 'range')
    return api.call({
      method: 'POST',
      path: `/open-apis/sheets/v3/spreadsheets/${enc(x!.token)}/sheets/${enc(sh.id)}/find`,
      body: {
        find: str(a, 'find'),
        find_condition: {
          range: range ? (range.includes('!') ? range : `${sh.id}!${range}`) : sh.id,
          ...(a.regex === true ? { search_by_regex: true } : {}),
        },
      },
    })
  },
  'feishu_sheet.write': async (api, a, x) => {
    const sh = await sheetOf(api, x!, a)
    if ('ok' in sh) return sh
    const rows = parseCsv(raw(a, 'csv'), ',').filter((r, i, all) => i < all.length - 1 || r.some((c) => c !== ''))
    if (!rows.length) return unsupported(t('csv 是空的，没有可写的内容'))
    const start = (str(a, 'start_cell') || 'A1').toUpperCase().match(/^([A-Z]+)(\d+)$/)
    if (!start) return unsupported(t('start_cell 要写成 A1 这样的单元格'))
    const c0 = colNum(start[1]!)
    const r0 = Number(start[2])
    const width = Math.max(...rows.map((r) => r.length))
    const values = rows.map((r) => [...r, ...Array(width - r.length).fill('')])
    const range = `${sh.id}!${start[1]}${r0}:${colName(c0 + width - 1)}${r0 + rows.length - 1}`
    const r = await api.call({
      method: 'PUT',
      path: `/open-apis/sheets/v2/spreadsheets/${enc(x!.token)}/values`,
      body: { valueRange: { range, values } },
    })
    return r.ok ? { ok: true, data: { range, updated_cells: rows.length * width, ...(r.data as object) } } : r
  },
  'feishu_base.tables': (api, a, x) =>
    api.call({
      path: `/open-apis/bitable/v1/apps/${enc(x!.token)}/tables`,
      query: { page_size: num(a, 'limit') ?? 100 },
    }),
  'feishu_base.fields': (api, a, x) =>
    api.call({
      path: `/open-apis/bitable/v1/apps/${enc(x!.token)}/tables/${enc(str(a, 'table'))}/fields`,
      query: { page_size: 100 },
    }),
  'feishu_base.records': (api, a, x) => {
    const fields = list(a, 'fields')
    return api.call({
      path: `/open-apis/bitable/v1/apps/${enc(x!.token)}/tables/${enc(str(a, 'table'))}/records`,
      query: {
        page_size: num(a, 'limit') ?? 50,
        page_token: str(a, 'page_token'),
        field_names: fields.length ? JSON.stringify(fields) : undefined,
      },
    })
  },
  'feishu_base.search': async (api, a, x) => {
    const base = `/open-apis/bitable/v1/apps/${enc(x!.token)}/tables/${enc(str(a, 'table'))}`
    let fields = list(a, 'fields')
    // 没指定在哪些字段里搜：用全部文本字段（类型 1），和 lark-cli 的关键字搜索一个意思
    if (!fields.length) {
      const f = await api.call({ path: `${base}/fields`, query: { page_size: 100 } })
      if (!f.ok) return f
      fields = ((f.data as { items?: { field_name: string; type: number }[] }).items ?? [])
        .filter((x) => x.type === 1)
        .map((x) => x.field_name)
    }
    const kw = str(a, 'keyword')
    return api.call({
      method: 'POST',
      path: `${base}/records/search`,
      query: { page_size: num(a, 'limit') ?? 50 },
      body: kw
        ? {
            filter: {
              conjunction: 'or',
              conditions: fields.map((f) => ({ field_name: f, operator: 'contains', value: [kw] })),
            },
          }
        : {},
    })
  },
  'feishu_base.get': (api, a, x) =>
    api.call({
      method: 'POST',
      path: `/open-apis/bitable/v1/apps/${enc(x!.token)}/tables/${enc(str(a, 'table'))}/records/batch_get`,
      body: { record_ids: list(a, 'record_ids') },
    }),
  'feishu_base.upsert': (api, a, x) => {
    const base = `/open-apis/bitable/v1/apps/${enc(x!.token)}/tables/${enc(str(a, 'table'))}/records`
    const fields = a.record && typeof a.record === 'object' ? a.record : {}
    const id = str(a, 'record_id')
    return id
      ? api.call({ method: 'PUT', path: `${base}/${enc(id)}`, body: { fields } })
      : api.call({ method: 'POST', path: base, body: { fields } })
  },
  'feishu_markdown.fetch': async (api, _a, x) => {
    const r = await api.call({ path: `/open-apis/drive/v1/files/${enc(x!.token)}/download`, binary: true })
    if (!r.ok) return r
    return { ok: true, data: { content: Buffer.isBuffer(r.data) ? r.data.toString('utf8') : JSON.stringify(r.data) } }
  },
}
