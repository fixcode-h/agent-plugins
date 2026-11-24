import { looksLikeToken, parseFeishuUrl, refUrl, type FeishuKind, type FeishuRef } from '../../shared/feishu/links.ts'
import { t } from '../../shared/i18n.ts'
import { runLark } from './cli.ts'
import type { Target } from './ops/types.ts'

/**
 * 把 Agent 给的链接或 token 归一成「文档身份」（设计稿 4.1）：经 lark-cli drive +inspect 拿到类型、标题、规范 token，
 * wiki 节点解开成真正挂的文档。权限一律按规范 token 判：换一个 wiki 链接、直接传 token 都绕不过去。
 * 取标题只读元数据、不读正文（问题 Q2：卡片上要有标题你才判断得了）；没被允许时标题也不回给 Agent。
 * 结果按原样的 token 缓存（全局，进程内）：同一篇文档在多个对话里不用重复问 lark-cli
 */

export interface Resolver {
  bin: () => string
  cwd: () => string
}

// 模块状态：缓存，原样 token → 归一结果；插件重启就重新问
const cache = new Map<string, Target>()

/** 认 Agent 给的参数：飞书链接，或者裸 token（按操作默认的类型） */
export function refOf(input: string, kind: FeishuKind): FeishuRef | undefined {
  const s = input.trim()
  if (!s) return undefined
  const byUrl = parseFeishuUrl(s)
  if (byUrl) return byUrl
  return looksLikeToken(s) ? { kind, token: s, url: '' } : undefined
}

export async function resolveRef(
  r: Resolver,
  ref: FeishuRef,
  signal?: AbortSignal,
): Promise<Target | { error: string }> {
  const hit = cache.get(ref.token)
  if (hit) return hit
  // 妙记没有 inspect：token 就是它自己，标题等读了才知道
  if (ref.kind === 'minutes') return { kind: 'minutes', token: ref.token, url: refUrl(ref), title: '' }
  const args = ['drive', '+inspect', '--url', ref.url || ref.token]
  if (!ref.url) args.push('--type', ref.kind)
  const res = await runLark({ bin: r.bin(), args, cwd: r.cwd(), signal, timeoutMs: 30_000 })
  if (!res.ok || !res.data || typeof res.data !== 'object')
    return { error: res.error?.message || t('认不出这个飞书链接') }
  const d = res.data as Record<string, unknown>
  const node = (d.wiki_node ?? {}) as Record<string, unknown>
  const target: Target = {
    kind: String(d.type ?? ref.kind),
    token: String(d.token ?? ref.token),
    url: String(d.url ?? refUrl(ref)),
    title: String(d.title ?? ''),
    ...(node.space_id ? { spaceId: String(node.space_id) } : {}),
    ...(node.node_token ? { nodeToken: String(node.node_token) } : {}),
  }
  cache.set(ref.token, target)
  // 解开后的规范 token 也记一份：之后直接用规范 token 调的不用再问
  if (!cache.has(target.token)) cache.set(target.token, { ...target, nodeToken: undefined })
  return target
}

/** 测试用：清掉缓存 */
export const clearResolveCache = () => cache.clear()
