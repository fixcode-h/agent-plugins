import type { McpCallContext } from '../plugins/sdk.ts'
import { findFeishuLinks, type FeishuRef } from '../../shared/feishu/links.ts'
import { t } from '../../shared/i18n.ts'
import type { AuditResult } from './audit.ts'
import type { GrantBy, GrantStore } from './grants.ts'
import { str } from './ops/args.ts'
import type { OpArgs, OpDef, Target } from './ops/types.ts'
import { refOf, resolveRef, type Resolver } from './resolve.ts'

/**
 * 权限闸（设计稿第 4 节）：每次飞书操作先过这里，决定放行、弹卡问用户，还是拒绝。
 *
 * - read：这篇在这个对话的读名单里（用户贴过的链接、卡片上一直允许过的、这个对话新建的、父对话能读的、信任的知识库）
 *   直接放行；文档里引用的、Agent 自己找来的都弹卡，卡上写清从哪来。
 * - write：只写卡片上允许过的、这个对话新建的；每次弹卡都带改动摘要和差异。
 * - discover：搜索、列举每次弹卡（同一类在这个对话里可以一直允许），结果里的文档不自动授权。
 * 「用户给了什么」只认用户亲口说的话（ctx.userWords），文档内容、Agent 的回复里写的链接骗不到授权
 */

export interface GateConfig {
  /** 读引用链接要不要弹卡（默认要） */
  refAsk: boolean
  /** 搜索、列举类：ask 每次问、deny 一律不许 */
  discover: 'ask' | 'deny'
  /** 信任的知识库空间 id：里面的文档读取不弹卡 */
  trustedSpaces: string[]
}

export interface GateDeps {
  resolver: Resolver
  grants: GrantStore
  config: () => GateConfig
}

export type GateResult =
  | { ok: true; target?: Target; how: AuditResult; why: string }
  | { ok: false; code: string; message: string; target?: Target; how?: AuditResult }

const quote = (s: string) => (s ? `《${s}》` : t('（标题未知）'))

/** 用户亲口贴过的链接里有没有这一篇（原样 token 对得上，或者解开后的规范 token 对得上） */
async function fromUserLinks(d: GateDeps, c: McpCallContext, target: Target, raw: FeishuRef): Promise<boolean> {
  const words = c.userWords?.() ?? []
  const refs = words.flatMap((w) => findFeishuLinks(w.text))
  if (!refs.length) return false
  const g = await d.grants.get(c.taskId)
  const same = (tk: string) => tk === target.token || tk === target.nodeToken || tk === raw.token
  if (refs.some((r) => same(r.token))) return true
  // 每次最多解开 30 个还没解开过的链接：用户一次贴了一大堆时不至于卡住
  let budget = 30
  for (const r of refs) {
    let canon = g.seeds[r.token]
    if (canon === undefined && budget-- > 0) {
      const res = await resolveRef(d.resolver, r, c.signal)
      canon = 'error' in res ? '' : res.token
      g.seeds[r.token] = canon
      await d.grants.save(c.taskId)
    }
    if (canon && same(canon)) return true
  }
  return false
}

/** 能不能直接读：返回放行的原因，不能返回 undefined */
async function readableBy(
  d: GateDeps,
  c: McpCallContext,
  target: Target,
  raw: FeishuRef,
): Promise<GrantBy | undefined> {
  const hit = await d.grants.readable(c.taskId, target.token)
  if (hit) return hit.by
  if (target.spaceId && d.config().trustedSpaces.includes(target.spaceId)) return 'trusted'
  if (await fromUserLinks(d, c, target, raw)) {
    await d.grants.grant(c.taskId, 'read', target.token, { title: target.title, kind: target.kind, by: 'link' })
    return 'link'
  }
  return undefined
}

/** 卡片上「Agent 说的理由」：标明是 Agent 说的，不是事实 */
const reasonLine = (a: OpArgs) => (str(a, 'reason') ? t('Agent 说的理由：{why}', { why: str(a, 'reason') }) : '')

async function ask(
  c: McpCallContext,
  req: { title: string; detail: string[]; rule: string; ruleLabel: string; diff?: string },
): Promise<{ allow: boolean; always: boolean; noCard?: boolean }> {
  // 不在对话里的调用（工作流节点这类）没法出卡：按拒绝，原因另写
  if (!c.confirm) return { allow: false, always: false, noCard: true }
  const r = await c.confirm({
    title: req.title,
    detail: req.detail.filter(Boolean).join('\n'),
    rule: req.rule,
    ruleLabel: req.ruleLabel,
    ...(req.diff ? { diff: req.diff } : {}),
  })
  return { allow: r.allow, always: !!(r.allow && r.always) }
}

const denied = (op: OpDef, target?: Target, noCard?: boolean): GateResult => ({
  ok: false,
  code: 'permission_denied',
  how: 'denied',
  target,
  message: noCard
    ? t(
        '「{label}」要用户在对话里确认，这次调用不在对话里（工作流节点、派出的子任务），没法确认。请在对话里做，或者让用户先把链接发给你。',
        {
          label: op.label(),
        },
      )
    : t('用户没有允许这次「{label}」。不要换个写法或换个链接重试；确实需要的话，直接问用户。', { label: op.label() }),
})

/** 解析目标：没给、认不出、类型不对都直接报错，写清怎么改 */
async function targetOf(d: GateDeps, op: OpDef, a: OpArgs, c: McpCallContext) {
  const spec = op.target
  if (!spec) return {}
  const input = str(a, spec.arg)
  if (!input) {
    if (spec.optional) return {}
    return { error: t('缺少参数 {arg}：给飞书链接或 token', { arg: spec.arg }) }
  }
  const raw = refOf(input, spec.kind)
  if (!raw) return { error: t('{arg} 不是飞书链接或 token：{v}', { arg: spec.arg, v: input.slice(0, 120) }) }
  const res = await resolveRef(d.resolver, raw, c.signal)
  if ('error' in res)
    return res.type === 'not_installed'
      ? { error: res.error, code: 'cli_unavailable' }
      : { error: t('解析飞书链接失败：{why}', { why: res.error }) }
  if (!spec.accept.includes(res.kind))
    return {
      error: t(
        '这个链接是 {kind}，{tool} 只认 {accept}；表格用 feishu_sheet，多维表格用 feishu_base，文档用 feishu_doc',
        {
          kind: res.kind,
          tool: op.tool,
          accept: spec.accept.join(' / '),
        },
      ),
    }
  return { target: res, raw }
}

export async function gate(d: GateDeps, op: OpDef, a: OpArgs, c: McpCallContext): Promise<GateResult> {
  const x = await targetOf(d, op, a, c)
  if ('error' in x && x.error)
    return { ok: false, code: ('code' in x && x.code) || 'invalid_argument', message: x.error }
  const { target, raw } = x as { target?: Target; raw?: FeishuRef }
  const cfg = d.config()
  const head = (label: string) => t('飞书：{label}', { label })

  if (op.level === 'discover') {
    if (cfg.discover === 'deny')
      return {
        ok: false,
        code: 'permission_denied',
        how: 'denied',
        message: t('飞书插件设置里关掉了搜索和列举类操作。需要的话请用户去设置里打开，或者直接给你文档链接。'),
      }
    const r = await ask(c, {
      title: head(op.label()),
      detail: [
        target ? t('位置：{title} {url}', { title: quote(target.title), url: target.url }) : '',
        op.summary?.(a) ?? '',
        reasonLine(a),
        t('搜出来的文档不会自动授权，要读哪篇时还会再问你。'),
      ],
      rule: `discover:${op.tool}.${op.action}`,
      ruleLabel: op.label(),
    })
    return r.allow ? { ok: true, target, how: r.always ? 'always' : 'once', why: 'card' } : denied(op, target, r.noCard)
  }

  if (op.level === 'read') {
    const by = await readableBy(d, c, target!, raw!)
    if (by) return { ok: true, target, how: 'auto', why: by }
    const g = await d.grants.get(c.taskId)
    const ref = g.refs[raw!.token] ?? g.refs[target!.token]
    if (ref && !cfg.refAsk) return { ok: true, target, how: 'auto', why: 'ref' }
    const r = await ask(c, {
      title: head(t('读取 {title}', { title: quote(target!.title) })),
      detail: [
        t('链接：{url}', { url: target!.url }),
        ref
          ? t('来源：{from} 里引用的文档', { from: quote(ref.fromTitle) })
          : t('来源：不在你给的链接范围内（Agent 自己找到的）'),
        t('操作：{label}', { label: op.label() }),
        reasonLine(a),
      ],
      rule: `doc-read:${target!.token}`,
      ruleLabel: t('读取 {title}', { title: quote(target!.title) }),
    })
    if (!r.allow) return denied(op, target, r.noCard)
    if (r.always)
      await d.grants.grant(c.taskId, 'read', target!.token, { title: target!.title, kind: target!.kind, by: 'card' })
    return { ok: true, target, how: r.always ? 'always' : 'once', why: 'card' }
  }

  // 写：新建文档按位置问；改已有文档先看写名单
  if (!op.creates && (await d.grants.writable(c.taskId, target!.token)))
    return { ok: true, target, how: 'auto', why: 'card' }
  const name = op.creates ? (target ? quote(target.title) : t('我的文档库')) : quote(target!.title)
  const r = await ask(c, {
    title: head(
      op.creates ? t('在 {where} 新建文档', { where: name }) : t('{label} {title}', { label: op.label(), title: name }),
    ),
    detail: [target ? t('链接：{url}', { url: target.url }) : '', op.summary?.(a) ?? '', reasonLine(a)],
    diff: op.diff?.(a),
    rule: op.creates ? `doc-create:${target?.token ?? 'my_library'}` : `doc-write:${target!.token}`,
    ruleLabel: op.creates ? t('在 {where} 新建文档', { where: name }) : t('写入 {title}', { title: name }),
  })
  if (!r.allow) return denied(op, target, r.noCard)
  if (r.always && !op.creates)
    await d.grants.grant(c.taskId, 'write', target!.token, { title: target!.title, kind: target!.kind, by: 'card' })
  return { ok: true, target, how: r.always ? 'always' : 'once', why: 'card' }
}
