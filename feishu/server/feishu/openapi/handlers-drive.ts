import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { t } from '../../../shared/i18n.ts'
import { list, num, str } from '../ops/args.ts'
import type { ApiHandler } from './types.ts'

/** 搜索、知识库、妙记的开放接口实现（token 模式）。妙记搜索没有开放接口，不登记（token 模式下报不支持） */

const enc = encodeURIComponent

export const DRIVE_API: Record<string, ApiHandler> = {
  'feishu_search.docs': async (api, a) => {
    const types = list(a, 'doc_types').map((x) => x.toUpperCase())
    const filter = {
      ...(types.length ? { doc_types: types } : {}),
      ...(a.only_title === true ? { only_title: true } : {}),
    }
    const r = await api.call({
      method: 'POST',
      path: '/open-apis/search/v2/doc_wiki/search',
      body: {
        query: str(a, 'query'),
        doc_filter: filter,
        wiki_filter: filter,
        page_size: num(a, 'limit') ?? 20,
        ...(str(a, 'page_token') ? { page_token: str(a, 'page_token') } : {}),
      },
    })
    if (!r.ok) return r
    const d = r.data as {
      res_units?: Record<string, unknown>[]
      has_more?: boolean
      page_token?: string
      total?: number
    }
    // 整理成 lark-cli drive +search 那样的条目：标题、类型、链接（高亮标记去掉）
    const items = (d.res_units ?? []).map((u) => {
      const m = (u.result_meta ?? {}) as Record<string, unknown>
      return {
        title: String(u.title_highlighted ?? '').replace(/<\/?[^>]+>/g, ''),
        type: String(m.doc_types ?? u.entity_type ?? '').toLowerCase(),
        url: String(m.url ?? ''),
        token: String(m.token ?? ''),
        ...(m.owner_name ? { owner: m.owner_name } : {}),
      }
    })
    return { ok: true, data: { items, has_more: !!d.has_more, page_token: d.page_token ?? '', total: d.total } }
  },
  'feishu_wiki.node': (api, _a, x) =>
    api.call({
      path: '/open-apis/wiki/v2/spaces/get_node',
      query: { token: x!.nodeToken ?? x!.token, obj_type: 'wiki' },
    }),
  'feishu_wiki.children': (api, a, x) =>
    api.call({
      path: `/open-apis/wiki/v2/spaces/${enc(x?.spaceId ?? '')}/nodes`,
      query: { parent_node_token: x?.nodeToken, page_size: num(a, 'limit'), page_token: str(a, 'page_token') },
    }),
  'feishu_wiki.spaces': (api, a) =>
    api.call({
      path: '/open-apis/wiki/v2/spaces',
      query: { page_size: num(a, 'limit'), page_token: str(a, 'page_token') },
    }),
  'feishu_minutes.detail': async (api, a, x, io) => {
    const r = await api.call({ path: `/open-apis/minutes/v1/minutes/${enc(x!.token)}` })
    if (!r.ok || a.transcript !== true) return r
    // 逐字稿可能很长：写进这个对话的缓存目录，只回路径
    const tr = await api.call({
      path: `/open-apis/minutes/v1/minutes/${enc(x!.token)}/transcript`,
      query: { file_format: 'txt' },
      binary: true,
      signal: io.signal,
    })
    if (!tr.ok) return { ok: true, data: { ...(r.data as object), transcriptError: tr.error?.message } }
    const f = path.join(io.dir, `${x!.token}-transcript.txt`)
    await writeFile(f, Buffer.isBuffer(tr.data) ? tr.data : JSON.stringify(tr.data))
    return { ok: true, data: { ...(r.data as object), transcriptFile: f, note: t('逐字稿写在 transcriptFile 里') } }
  },
}
