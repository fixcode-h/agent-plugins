import { h, t } from '../../host.ts'
import { satisfies } from './plugins/model.ts'

/**
 * GameTest「已达成就跳过」（GameTest 1.7.0，skipIf）：步骤上写一个条件，回放到这一步时条件已经成立（勾已经勾上、
 * 按钮已经是「已领取」）就不做，状态记 already（算通过）。条件和 assert 共用，录制时 GameTest 会读点一下前后的界面，
 * 把变化写进 hint.state 当候选，把握高的直接写成 skipIf（by: auto）。这里是面板这边的纯逻辑：人话、候选、改写步骤
 */

/** 跳过条件能写的条件字段（和 GameTest 的 GameTestCondition::Keys 一致） */
export const COND_KEYS = [
  'exists',
  'visible',
  'enabled',
  'text',
  'textContains',
  'textLike',
  'checked',
  'count',
  'selected',
  'selectedProperty',
  'stateKey',
  'field',
  'image',
  'any',
  'equals',
] as const

/** 条件之外的配置字段 */
export const SKIP_CONFIG_KEYS = ['target', 'also', 'settleMs', 'verify', 'verifyTimeoutMs', 'by'] as const

export interface GtSkipIf {
  target?: string
  also?: number
  settleMs?: number
  verify?: boolean
  verifyTimeoutMs?: number
  by?: string
  [k: string]: unknown
}

/** 录制时点完变了的一处（hint.state.cands） */
export interface GtStateCand {
  target?: string
  kind: string
  cond: Record<string, unknown>
  before?: string
  after?: string
  score: number
}

export interface GtHintState {
  cands: GtStateCand[]
  picked?: number
  /** GameTest 1.8.0：没自动写条件时，录制算好的「连带跳过几步」建议值，加条件时带上 */
  also?: number
}

/** 跳过时写进步骤结果的 payload.skip；连带跳过的只有 with（带头那一步的序号） */
export interface GtSkipPayload {
  cond?: Record<string, unknown>
  say?: string
  actual?: string
  target?: string
  waitedMs?: number
  also?: number
  with?: number
}

/** 面板认得 skipIf 的最低 GameTest 版本：旧版碰到不认识的字段会整个场景解析失败 */
export const SKIP_MIN_VERSION = '1.7.0'

export const skipSupported = (gameTestVersion?: string) =>
  !gameTestVersion || satisfies(gameTestVersion.replace(/-.*$/, ''), `>=${SKIP_MIN_VERSION}`)

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function skipOf(def?: Record<string, unknown>): GtSkipIf | undefined {
  return isObj(def?.skipIf) ? (def.skipIf as GtSkipIf) : undefined
}

/** 只留条件字段（去掉 target、also 这些配置） */
export function condOf(skip: GtSkipIf): Record<string, unknown> {
  return Object.fromEntries(Object.entries(skip).filter(([k]) => !(SKIP_CONFIG_KEYS as readonly string[]).includes(k)))
}

export function stateOf(hint?: Record<string, unknown>): GtHintState | undefined {
  const s = hint?.state
  if (!isObj(s) || !Array.isArray(s.cands)) return undefined
  const cands = (s.cands as unknown[]).filter(
    (c): c is GtStateCand => isObj(c) && typeof c.kind === 'string' && isObj(c.cond) && typeof c.score === 'number',
  )
  return {
    cands,
    picked: typeof s.picked === 'number' ? s.picked : undefined,
    also: typeof s.also === 'number' && s.also > 0 ? s.also : undefined,
  }
}

const q = (v: unknown) => (typeof v === 'string' ? `「${v}」` : JSON.stringify(v))

/** 一个条件说成人话（「已勾上」「文字像「已领取」」）；多个条件用「、」连，any 用「或」 */
export function condSay(cond: Record<string, unknown>): string {
  const parts: string[] = []
  const b = (k: string, yes: string, no: string) => {
    if (typeof cond[k] === 'boolean') parts.push(cond[k] ? yes : no)
  }
  b('checked', t('已勾上'), t('没勾上'))
  b('exists', t('在'), t('不在了'))
  b('visible', t('看得见'), t('看不见'))
  b('enabled', t('能点'), t('变灰'))
  if (typeof cond.textLike === 'string') parts.push(t('文字像{s}', { s: q(cond.textLike) }))
  if (typeof cond.text === 'string') parts.push(t('文字是{s}', { s: q(cond.text) }))
  if (typeof cond.textContains === 'string') parts.push(t('文字含{s}', { s: q(cond.textContains) }))
  if (typeof cond.image === 'string') parts.push(t('图片是 {s}', { s: cond.image }))
  if (typeof cond.field === 'string') parts.push(t('{f} = {v}', { f: cond.field, v: JSON.stringify(cond.equals) }))
  if (typeof cond.stateKey === 'string')
    parts.push(t('{f} = {v}', { f: cond.stateKey, v: JSON.stringify(cond.equals) }))
  if (typeof cond.selected === 'number') parts.push(t('选中第 {n} 项', { n: cond.selected }))
  if (typeof cond.count === 'number') parts.push(t('有 {n} 个', { n: cond.count }))
  if (Array.isArray(cond.any))
    parts.push(
      (cond.any as unknown[])
        .filter(isObj)
        .map((c) => condSay(c))
        .join(t(' 或 ')),
    )
  return parts.join('、') || t('（没写条件）')
}

/** 行上的小标签：「已勾上就跳过 +1」 */
export function skipLabel(skip: GtSkipIf): string {
  const also = typeof skip.also === 'number' && skip.also > 0 ? ` +${skip.also}` : ''
  return t('{c}就跳过', { c: condSay(condOf(skip)) }) + also
}

/** 候选的把握：≥7 高（录制时会自动写），4–6 中，更低不列 */
export const candLevel = (score: number) => (score >= 7 ? t('把握高') : score >= 5 ? t('把握中') : t('把握低'))

/**
 * 候选 → 跳过条件：条件字段 + 看的控件（候选没写 target 就是这一步自己的控件），保留原来的 also / verify 这些配置。
 * by 改成 user：人挑过了就不再是录制自动加的
 */
export function skipFromCand(cand: GtStateCand, old?: GtSkipIf, also?: number): GtSkipIf {
  return withConfig({ ...cand.cond, ...(cand.target ? { target: cand.target } : {}) }, old, also)
}

/** 新条件带上原来的 also / verify 这些配置（没有原来的就用录制的 also 建议值），by 记 user */
function withConfig(cond: GtSkipIf, old?: GtSkipIf, also?: number): GtSkipIf {
  const keep = old
    ? Object.fromEntries(
        Object.entries(old).filter(([k]) => (SKIP_CONFIG_KEYS as readonly string[]).includes(k) && k !== 'target'),
      )
    : also
      ? { also }
      : {}
  return { ...cond, ...keep, by: 'user' }
}

/** 快捷设置的三类条件（用户 2026-11-18：文本是不是某个文本、某个控件显不显示、某个勾选框勾没勾） */
export type QuickKind = 'text' | 'visible' | 'checked'

export interface QuickCond {
  kind: QuickKind
  /** 看哪个控件；空 = 这一步自己的控件 */
  target: string
  /** text：文字；visible / checked：'yes' | 'no' */
  value: string
}

/** 快捷设置 → 跳过条件。文字用 textLike（忽略数字和标点，「已领取(1/3)」也算「已领取」） */
export function skipFromQuick(q: QuickCond, old?: GtSkipIf, also?: number): GtSkipIf | undefined {
  const target = q.target.trim()
  const base: GtSkipIf = target ? { target } : {}
  if (q.kind === 'text') {
    const text = q.value.trim()
    if (!text) return undefined
    return withConfig({ ...base, textLike: text }, old, also)
  }
  return withConfig({ ...base, [q.kind]: q.value !== 'no' }, old, also)
}

/** 现有条件能不能用快捷设置改（只有一个条件、是这三类之一），能就读出来 */
export function quickOf(skip?: GtSkipIf): QuickCond | undefined {
  if (!skip) return undefined
  const cond = condOf(skip)
  const keys = Object.keys(cond)
  if (keys.length !== 1) return undefined
  const target = skip.target ?? ''
  if (typeof cond.textLike === 'string') return { kind: 'text', target, value: cond.textLike }
  if (typeof cond.text === 'string') return { kind: 'text', target, value: cond.text }
  if (typeof cond.visible === 'boolean') return { kind: 'visible', target, value: cond.visible ? 'yes' : 'no' }
  if (typeof cond.checked === 'boolean') return { kind: 'checked', target, value: cond.checked ? 'yes' : 'no' }
  return undefined
}

/** 快捷设置的初值：按录制候选里同类的那个填（文字填点完变成的字），没有就用默认 */
export function quickDefault(kind: QuickKind, cands: GtStateCand[], stepText?: string): QuickCond {
  const c = cands.find((x) =>
    kind === 'text'
      ? typeof x.cond.textLike === 'string' || typeof x.cond.text === 'string'
      : typeof x.cond[kind] === 'boolean',
  )
  if (kind === 'text') {
    const v = c ? String(c.cond.textLike ?? c.cond.text) : (stepText ?? '')
    return { kind, target: c?.target ?? '', value: v }
  }
  return { kind, target: c?.target ?? '', value: c && c.cond[kind] === false ? 'no' : 'yes' }
}

/** 这个候选是不是现在用着的条件（条件和看的控件都一样） */
export function sameAsCand(skip: GtSkipIf | undefined, cand: GtStateCand) {
  if (!skip) return false
  return (skip.target ?? '') === (cand.target ?? '') && JSON.stringify(condOf(skip)) === JSON.stringify(cand.cond)
}

/**
 * 手写的条件 JSON（只写条件和 target 等配置的对象）：解析并检查字段，错了返回 error（中文，给人看）
 */
export function parseSkipText(text: string): { skip?: GtSkipIf; error?: string } {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch (e) {
    return { error: t('不是合法的 JSON：{e}', { e: (e as Error).message }) }
  }
  if (!isObj(v)) return { error: t('要写成对象，例如 {"checked": true}') }
  const bad = Object.keys(v).filter(
    (k) => !(COND_KEYS as readonly string[]).includes(k) && !(SKIP_CONFIG_KEYS as readonly string[]).includes(k),
  )
  if (bad.length) return { error: t('不认识的字段：{k}', { k: bad.join('、') }) }
  if (!Object.keys(condOf(v)).filter((k) => k !== 'equals').length) return { error: t('至少写一个条件') }
  return { skip: v as GtSkipIf }
}

/** 第 i 步是不是被前面哪一步连带跳过（结果里 payload.skip.with） */
export function skipWith(payload?: Record<string, unknown>): number | undefined {
  const s = payload?.skip
  return isObj(s) && typeof s.with === 'number' ? s.with : undefined
}

export function skipPayload(payload?: Record<string, unknown>): GtSkipPayload | undefined {
  return isObj(payload?.skip) ? (payload.skip as GtSkipPayload) : undefined
}

/**
 * 录制时推断跳过条件的参数（gt.record.start 的 inferSkip、stateWindowMs）：来自 UE 插件设置的 GameTest 录制一组。
 * 旧版 GameTest 不认这两个参数，不传
 */
export function recordSkipArgs(gameTestVersion?: string): Record<string, string | number> {
  if (gameTestVersion && !skipSupported(gameTestVersion)) return {}
  const c = h().config()
  // 默认 suggest（用户 2026-11-18：默认不跳过，需要用户设置）：只列候选，不自动写条件
  const mode = c.gtInferSkip === 'auto' || c.gtInferSkip === 'off' ? c.gtInferSkip : 'suggest'
  const sec = typeof c.gtStateWindow === 'number' && c.gtStateWindow > 0 ? c.gtStateWindow : 2
  return { inferSkip: mode as string, stateWindowMs: Math.round(Math.min(10, Math.max(0.3, sec)) * 1000) }
}
