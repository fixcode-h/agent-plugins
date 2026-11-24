/**
 * 飞书链接和 token 的识别（前后端共用，纯函数）。
 *
 * 权限按「规范 token」判（服务端经 lark-cli drive +inspect 归一），这里只负责从文字里认出可能指向飞书文档的东西：
 * - 用户消息里贴的链接（授权的种子）；
 * - 文档内容里引用的链接、`<cite doc-id=…>`、内嵌表格 `<sheet token=…>`（读之前要弹卡问）。
 * 认不出的不算链接，宁可漏认也不把普通网址当成飞书文档
 */

/** 飞书 / Lark 的域名：企业自定义域名（xxx.feishu.cn）、国际版、办公套件新域名 */
const HOST = /(^|\.)(feishu\.cn|feishu\.net|larksuite\.com|larkoffice\.com|larkenterprise\.com)$/i

/** 链接路径里的类型段 → 文档类型（和 lark-cli drive +inspect 的 type 一致） */
const PATH_KINDS: [RegExp, FeishuKind][] = [
  [/^\/docx\/([A-Za-z0-9]{8,})/, 'docx'],
  [/^\/docs\/([A-Za-z0-9]{8,})/, 'doc'],
  [/^\/doc\/([A-Za-z0-9]{8,})/, 'doc'],
  [/^\/wiki\/([A-Za-z0-9]{8,})/, 'wiki'],
  [/^\/sheets\/([A-Za-z0-9]{8,})/, 'sheet'],
  [/^\/base\/([A-Za-z0-9]{8,})/, 'bitable'],
  [/^\/file\/([A-Za-z0-9]{8,})/, 'file'],
  [/^\/drive\/folder\/([A-Za-z0-9]{8,})/, 'folder'],
  [/^\/slides\/([A-Za-z0-9]{8,})/, 'slides'],
  [/^\/mindnotes\/([A-Za-z0-9]{8,})/, 'mindnote'],
  [/^\/minutes\/([A-Za-z0-9]{8,})/, 'minutes'],
]

export type FeishuKind =
  | 'docx'
  | 'doc'
  | 'wiki'
  | 'sheet'
  | 'bitable'
  | 'file'
  | 'folder'
  | 'slides'
  | 'mindnote'
  | 'minutes'

/** 一个指向飞书资源的引用：kind + token 是原样认出的（wiki 节点还没解开），url 是原文 */
export interface FeishuRef {
  kind: FeishuKind
  token: string
  url: string
}

/** 认一个链接；不是飞书链接返回 undefined */
export function parseFeishuUrl(raw: string): FeishuRef | undefined {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return undefined
  }
  if (!/^https?:$/.test(u.protocol) || !HOST.test(u.hostname)) return undefined
  for (const [re, kind] of PATH_KINDS) {
    const m = re.exec(u.pathname)
    if (m) return { kind, token: m[1], url: raw.trim() }
  }
  return undefined
}

/** 看起来像 token 的参数（不是链接）：字母数字，8 位以上 */
export const looksLikeToken = (s: string) => /^[A-Za-z0-9]{8,64}$/.test(s.trim())

/** 网址的大致样子：到空白、引号、尖括号、中文标点为止 */
const URL_RE = /https?:\/\/[^\s"'<>()（）【】「」，。；、]+/g

/** 文字里出现的飞书链接（去重，按出现顺序） */
export function findFeishuLinks(text: string): FeishuRef[] {
  const out: FeishuRef[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(URL_RE)) {
    const ref = parseFeishuUrl(m[0].replace(/[.,;:!?]+$/, ''))
    if (ref && !seen.has(ref.token)) {
      seen.add(ref.token)
      out.push(ref)
    }
  }
  return out
}

/** cite 的 file-type 写法 → 文档类型 */
const CITE_KINDS: Record<string, FeishuKind> = {
  docx: 'docx',
  doc: 'doc',
  wiki: 'wiki',
  sheet: 'sheet',
  sheets: 'sheet',
  bitable: 'bitable',
  base: 'bitable',
  file: 'file',
  slides: 'slides',
  mindnote: 'mindnote',
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? ''

/**
 * 文档内容里引用的飞书资源：链接、`<cite type="doc" doc-id=… file-type=…>`、内嵌 `<sheet token=…>` / `<bitable token=…>`。
 * 返回原样的引用（token 未归一），fromTitle 由调用方补
 */
export function findCitedRefs(content: string): FeishuRef[] {
  const out = findFeishuLinks(content)
  const seen = new Set(out.map((r) => r.token))
  const push = (kind: FeishuKind | undefined, token: string, url: string) => {
    if (!kind || !looksLikeToken(token) || seen.has(token)) return
    seen.add(token)
    out.push({ kind, token, url })
  }
  for (const m of content.matchAll(/<cite\b[^>]*>/g)) {
    const tag = m[0]
    if (attr(tag, 'type') && attr(tag, 'type') !== 'doc') continue
    const href = attr(tag, 'href')
    const byHref = href ? parseFeishuUrl(href) : undefined
    if (byHref) push(byHref.kind, byHref.token, byHref.url)
    else push(CITE_KINDS[attr(tag, 'file-type') || 'docx'], attr(tag, 'doc-id') || attr(tag, 'token'), '')
  }
  for (const m of content.matchAll(/<(sheet|bitable)\b[^>]*>/g))
    push(m[1] === 'sheet' ? 'sheet' : 'bitable', attr(m[0], 'token'), '')
  return out
}

/** 文档的链接（给人看、给 Agent 用）：有原文链接用原文，没有就按 token 拼一个通用的 */
export function refUrl(ref: { kind: string; token: string; url?: string }) {
  if (ref.url) return ref.url
  const seg: Record<string, string> = {
    docx: 'docx',
    doc: 'docs',
    wiki: 'wiki',
    sheet: 'sheets',
    bitable: 'base',
    file: 'file',
    slides: 'slides',
    mindnote: 'mindnotes',
    minutes: 'minutes',
  }
  return `https://feishu.cn/${seg[ref.kind] ?? 'docx'}/${ref.token}`
}
