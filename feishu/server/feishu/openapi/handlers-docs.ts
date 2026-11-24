import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { t } from '../../../shared/i18n.ts'
import { num, raw, str } from '../ops/args.ts'
import type { ApiHandler } from './types.ts'

/**
 * 文档、评论、搜索、知识库、妙记的开放接口实现（token 模式，用户 2026-11-24 选「读写，改文档正文除外」）。
 * 回包尽量整理成和 lark-cli 同样的形状（document.content、items），后面的结果整理、抽引用不用分两套
 */

const enc = encodeURIComponent

/** 评论接口要文件类型：docx / doc / sheet / bitable / slides / file */
const fileType = (kind: string) => (kind === 'wiki' ? 'docx' : kind)

/** 评论正文：纯文本一段 */
const elements = (text: string) => [{ type: 'text_run', text_run: { text } }]

export const DOC_API: Record<string, ApiHandler> = {
  'feishu_doc.fetch': async (api, a, x) => {
    if (x!.kind !== 'docx')
      return {
        ok: false,
        error: { type: 'not_supported', message: t('token 模式只能读新版文档（docx）；旧版文档要用 lark-cli') },
      }
    const r = await api.call({ path: `/open-apis/docx/v1/documents/${enc(x!.token)}/raw_content`, query: { lang: 0 } })
    if (!r.ok) return r
    const content = String((r.data as { content?: unknown }).content ?? '')
    // 开放接口只给纯文本：没有 lark-cli 的结构标记，scope / keyword 这些按段落取的参数用不了，在结果里说明
    const extra = ['scope', 'keyword', 'start_block_id', 'end_block_id'].some((k) => str(a, k))
      ? { note: t('token 模式只能取整篇纯文本，按段落读的参数没有生效') }
      : {}
    return { ok: true, data: { document: { title: x!.title, content }, ...extra } }
  },
  'feishu_doc.links': async (api, _a, x) => {
    if (x!.kind !== 'docx') return { ok: true, data: { document: { content: '' } } }
    const r = await api.call({ path: `/open-apis/docx/v1/documents/${enc(x!.token)}/raw_content`, query: { lang: 0 } })
    return r.ok
      ? { ok: true, data: { document: { content: String((r.data as { content?: unknown }).content ?? '') } } }
      : r
  },
  'feishu_doc.media': async (api, a, _x, io) => {
    const tk = str(a, 'media_token')
    const r = await api.call({
      path: `/open-apis/drive/v1/medias/${enc(tk)}/download`,
      binary: true,
      signal: io.signal,
    })
    if (!r.ok) return r
    if (!Buffer.isBuffer(r.data)) return { ok: false, error: { message: t('下载到的不是文件') } }
    const out = path.join(io.dir, `${tk.replace(/[^\w.-]/g, '_')}-${Date.now()}`)
    await writeFile(out, r.data)
    return { ok: true, data: { saved_path: out, size: r.data.length } }
  },
  'feishu_comment.list': (api, a, x) =>
    api.call({
      path: `/open-apis/drive/v1/files/${enc(x!.token)}/comments`,
      query: {
        file_type: fileType(x!.kind),
        is_solved: (str(a, 'solved') || 'false') === 'true',
        page_size: num(a, 'limit'),
        page_token: str(a, 'page_token'),
      },
    }),
  'feishu_comment.add': (api, a, x) =>
    str(a, 'block_id')
      ? Promise.resolve({
          ok: false,
          error: {
            type: 'not_supported',
            message: t('token 模式只能加全文评论，不能评论到某一块；去掉 block_id 再试'),
          },
        })
      : api.call({
          method: 'POST',
          path: `/open-apis/drive/v1/files/${enc(x!.token)}/comments`,
          query: { file_type: fileType(x!.kind) },
          body: { reply_list: { replies: [{ content: { elements: elements(raw(a, 'text')) } }] } },
        }),
  'feishu_comment.reply': (api, a, x) =>
    api.call({
      method: 'POST',
      path: `/open-apis/drive/v1/files/${enc(x!.token)}/comments/${enc(str(a, 'comment_id'))}/replies`,
      query: { file_type: fileType(x!.kind) },
      body: { content: { elements: elements(raw(a, 'text')) } },
    }),
  'feishu_comment.resolve': (api, a, x) =>
    api.call({
      method: 'PATCH',
      path: `/open-apis/drive/v1/files/${enc(x!.token)}/comments/${enc(str(a, 'comment_id'))}`,
      query: { file_type: fileType(x!.kind) },
      body: { is_solved: true },
    }),
}
