import { refUrl, type FeishuRef } from '../../../shared/feishu/links.ts'
import { t } from '../../../shared/i18n.ts'
import type { Target } from '../ops/types.ts'
import type { FeishuApi } from './client.ts'

/**
 * token 模式下把链接归一成文档身份（和 lark-cli drive +inspect 同样的结果）：
 * wiki 节点经 get_node 解开成挂的文档，其余经 metas/batch_query 取类型和标题（只读元数据，不读正文）
 */
export async function inspectByApi(
  api: FeishuApi,
  ref: FeishuRef,
  signal?: AbortSignal,
): Promise<Target | { error: string; type?: string }> {
  const fail = (r: { error?: { message: string; type?: string } }) => ({
    error: r.error?.message || t('认不出这个飞书链接'),
    type: r.error?.type,
  })
  if (ref.kind === 'folder') return { kind: 'folder', token: ref.token, url: refUrl(ref), title: '' }
  if (ref.kind === 'wiki') {
    const r = await api.call({
      path: '/open-apis/wiki/v2/spaces/get_node',
      query: { token: ref.token, obj_type: 'wiki' },
      signal,
    })
    if (!r.ok) return fail(r)
    const n = ((r.data as { node?: Record<string, unknown> }).node ?? {}) as Record<string, unknown>
    const kind = String(n.obj_type ?? 'docx')
    const token = String(n.obj_token ?? '')
    if (!token) return { error: t('知识库节点没有挂文档') }
    return {
      kind,
      token,
      url: refUrl({ kind, token }),
      title: String(n.title ?? ''),
      ...(n.space_id ? { spaceId: String(n.space_id) } : {}),
      nodeToken: String(n.node_token ?? ref.token),
    }
  }
  const r = await api.call({
    method: 'POST',
    path: '/open-apis/drive/v1/metas/batch_query',
    body: { request_docs: [{ doc_token: ref.token, doc_type: ref.kind }], with_url: true },
    signal,
  })
  if (!r.ok) return fail(r)
  const d = r.data as { metas?: Record<string, unknown>[]; failed_list?: { code?: number }[] }
  const m = d.metas?.[0]
  if (!m)
    return {
      error: t('飞书说没有这篇文档或没有权限（{code}）', { code: d.failed_list?.[0]?.code ?? '' }),
      type: 'permission',
    }
  const kind = String(m.doc_type ?? ref.kind)
  const token = String(m.doc_token ?? ref.token)
  return { kind, token, url: String(m.url || refUrl({ kind, token })), title: String(m.title ?? '') }
}
