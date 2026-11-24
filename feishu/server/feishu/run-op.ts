import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { McpCallContext, McpResult } from '../plugins/sdk.ts'
import { findCitedRefs, findFeishuLinks, refUrl } from '../../shared/feishu/links.ts'
import { t } from '../../shared/i18n.ts'
import type { AuditLog, AuditResult } from './audit.ts'
import { runLark } from './cli.ts'
import { gate, type GateDeps } from './gate.ts'
import { str } from './ops/args.ts'
import type { OpArgs, OpDef, Target } from './ops/types.ts'

/**
 * 执行一次飞书操作：过权限闸 → 跑 lark-cli → 整理结果（抽引用、长内容写文件）→ 记审计。
 * 结果一律是紧凑 JSON（一个 text 块，同一份放 structuredContent）；出错 isError + {error, message}，message 写清下一步
 */

export interface RunDeps extends GateDeps {
  audit: AuditLog
  /** 这个对话的缓存目录（插件数据目录里，不在项目里：免得公司文档被提交进仓库） */
  cacheDir: (taskId: string) => string
}

/** 正文直接交给 Agent 的上限（读结构类最多 12000，ADR 0067）；超过的整篇写文件、只回开头和路径 */
const DOC_INLINE = 12_000
const DOC_HEAD = 4_000
/** 其余结果的上限 */
const JSON_INLINE = 4_000

const result = (obj: Record<string, unknown>, isError = false): McpResult => ({
  content: [{ type: 'text', text: JSON.stringify(obj) }],
  ...(isError ? { isError: true } : { structuredContent: obj }),
})
export const fail = (code: string, message: string, hint?: string) =>
  result({ error: code, message, ...(hint ? { hint } : {}) }, true)

/** 结果里的正文：docs +fetch 是 document.content，其余取常见的文字字段，都没有就整个 JSON */
export function textOf(data: unknown): string {
  if (typeof data === 'string') return data
  if (!data || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>
  const doc = d.document as Record<string, unknown> | undefined
  if (doc && typeof doc.content === 'string') return doc.content
  for (const k of ['content', 'csv', 'markdown', 'text']) if (typeof d[k] === 'string') return d[k] as string
  return JSON.stringify(data)
}

/** 新建出来的文档：结果里的链接或常见的 token 字段 */
export function createdToken(data: unknown): { token: string; url: string } | undefined {
  const s = JSON.stringify(data ?? {})
  const link = findFeishuLinks(s).find((r) => r.kind === 'docx' || r.kind === 'doc' || r.kind === 'wiki')
  if (link) return { token: link.token, url: link.url }
  const d = (data ?? {}) as Record<string, unknown>
  const doc = (d.document ?? d) as Record<string, unknown>
  const tk = [doc.document_id, doc.doc_token, doc.token, doc.obj_token].find((x) => typeof x === 'string' && x)
  return tk ? { token: String(tk), url: refUrl({ kind: 'docx', token: String(tk) }) } : undefined
}

async function spill(dir: string, name: string, text: string) {
  await mkdir(dir, { recursive: true })
  const f = path.join(dir, name.replace(/[^\w.-]/g, '_'))
  await writeFile(f, text)
  return f
}

/** 换掉参数里的 {out}（要落盘的文件）、{dir}（输出目录）：都在这个对话的缓存目录里，不用 Agent 给的路径 */
function placeholders(args: string[], dir: string, a: OpArgs) {
  const out = path.join(dir, `${str(a, 'media_token') || 'file'}-${Date.now()}`)
  return args.map((x) => (x === '{out}' ? out : x === '{dir}' ? dir : x))
}

export async function runOp(d: RunDeps, op: OpDef, a: OpArgs, c: McpCallContext): Promise<McpResult> {
  const t0 = Date.now()
  const note = (how: AuditResult, target: Target | undefined, detail?: string) =>
    d.audit
      .add({
        at: new Date().toISOString(),
        taskId: c.taskId,
        tool: op.tool,
        action: op.action,
        label: op.label(),
        level: op.level,
        target: target?.token ?? (str(a, 'query') || undefined),
        title: target?.title || undefined,
        result: how,
        detail,
        ms: Date.now() - t0,
      })
      .catch(() => {})

  const g = await gate(d, op, a, c)
  if (!g.ok) {
    if (g.how) await note(g.how, g.target, g.code)
    return fail(g.code, g.message)
  }
  const target = g.target
  const dir = d.cacheDir(c.taskId)
  await mkdir(dir, { recursive: true })
  const call = op.cli(a, target)
  const res = await runLark({
    bin: await d.resolver.bin(),
    args: placeholders(call.args, dir, a),
    stdin: call.stdin,
    cwd: dir,
    signal: c.signal,
  })
  if (!res.ok) {
    await note('error', target, res.error?.message)
    if (res.error?.type === 'not_installed') return fail('cli_unavailable', res.error.message, res.error.hint)
    return fail('cli_failed', t('lark-cli 报错：{msg}', { msg: res.error?.message ?? '' }), res.error?.hint)
  }
  await note(g.how, target, g.why)
  const base = target ? { title: target.title, url: target.url } : {}

  if (op.creates) {
    const made = createdToken(res.data)
    if (made)
      for (const k of ['read', 'write'] as const)
        await d.grants.grant(c.taskId, k, made.token, { title: str(a, 'title'), kind: 'docx', by: 'created' })
    return result({ ...base, created: made ?? null, note: t('新文档已经进了这个对话的可读可写名单') })
  }

  if (op.output === 'doc' || op.local === 'links') {
    const text = textOf(res.data)
    const refs = findCitedRefs(text)
    if (target && refs.length)
      await d.grants.noteRefs(
        c.taskId,
        refs.map((r) => r.token),
        target,
      )
    if (op.local === 'links') {
      const items = await Promise.all(
        refs.map(async (r) => ({
          kind: r.kind,
          token: r.token,
          url: refUrl(r),
          ...((await d.grants.readable(c.taskId, r.token)) ? { granted: true } : {}),
        })),
      )
      return result({
        ...base,
        count: items.length,
        items,
        note: t('没标 granted 的要读时会请用户确认；一次只读真正需要的'),
      })
    }
    const refNote = refs.length
      ? {
          refs: refs.length,
          refsNote: t('文档里引用了 {n} 个飞书链接，读它们会请用户确认；先用 action=links 看清单', { n: refs.length }),
        }
      : {}
    if (text.length <= DOC_INLINE) return result({ ...base, chars: text.length, content: text, ...refNote })
    const file = await spill(dir, `${target?.token ?? op.action}-${Date.now()}.txt`, text)
    return result({
      ...base,
      chars: text.length,
      truncated: true,
      content: text.slice(0, DOC_HEAD),
      file,
      fileNote: t('全文太长，写在这个文件里（插件缓存目录，24 小时后清掉）；也可以 scope=outline 看目录后按节读'),
      ...refNote,
    })
  }

  const json = JSON.stringify(res.data ?? null)
  const discover = op.level === 'discover' ? { note: t('结果里的文档没有自动授权，要读哪篇时会请用户确认') } : {}
  if (json.length <= JSON_INLINE) return result({ ...base, data: res.data ?? null, ...discover })
  const file = await spill(dir, `${op.tool}-${op.action}-${Date.now()}.json`, json)
  return result({
    ...base,
    truncated: true,
    head: json.slice(0, JSON_INLINE),
    file,
    fileNote: t('结果太长，完整 JSON 写在这个文件里（24 小时后清掉）；可以用 limit / page_token 分页'),
    ...discover,
  })
}
