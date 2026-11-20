import type { GtRef, GtTarget } from '../../../shared/gt-script/ref/types.ts'
import { h, t } from '../../host.ts'

/**
 * 列表、格子条目「怎么认」（GameTest 1.4.0）在网页这边共用的类型和小工具：
 * 录制暂停弹窗（GtKeyAsk）、全部字段（GtKeyFields）、步骤详情「回放怎么认」（GtMatchMode）都用。
 */

/** 一个候选：条件左边 by、完整条件 cond、来源 src、值 v、分数、命中几个（hint.key.cands / gt.keys 同形状） */
export interface KeyCand {
  by: string
  cond?: string
  src?: string
  v?: unknown
  score?: number
  hits?: number
  unique?: boolean
  changed?: boolean
  combo?: boolean
  why?: string
}

/** 步骤 hint.key：录制时挑的标识和候选快照 */
export interface StepKey {
  from: string
  base: string
  pos: string
  entry?: string
  count?: number
  by: 'auto' | 'rule' | 'pending' | 'user' | 'index' | 'text' | string
  cond?: string
  list?: boolean
  cands?: KeyCand[]
}

/** 录制状态里的 ask：正在暂停问的那一步。GameTest 2.0 起 target 是 {obj, part}，另给推荐的引用 ref 和 Widget 树节点 node */
export interface KeyAsk {
  step: number
  target: string | GtTarget
  ref?: GtRef
  node?: string
  pausedSec?: number
  gamePaused?: boolean
  container?: string
  containerClass?: string
  entryName?: string
  index?: number
  /** v3 的条目标识快照；GameTest 2.0 起可能没有 */
  key: StepKey
  shot?: string
  screen?: string
  text?: string
}

export interface KeyField extends KeyCand {
  path?: string
}
export interface KeyGroup {
  source: string
  title: string
  class?: string
  note?: string
  fields: KeyField[]
}
export interface KeysResult {
  groups: KeyGroup[]
  total: number
  count: number
  hasMore?: boolean
  nextOffset?: number
  truncated?: boolean
  luaNote?: string
  key?: StepKey
}
export interface PreviewResult {
  hits: number
  unique: boolean
  includesMine?: boolean
  count: number
}

/** gt.record.start 的询问方式：「设置 → 插件 → UE → GameTest 录制」 */
export function keyAskArgs() {
  const c = h().config()
  const mode = c.gtAskKey === 'always' || c.gtAskKey === 'never' ? c.gtAskKey : 'unsure'
  const timeout = typeof c.gtAskTimeout === 'number' && c.gtAskTimeout > 0 ? Math.round(c.gtAskTimeout) : 0
  return { askKey: mode as string, askTimeoutSec: timeout }
}

export function keyOf(hint: Record<string, unknown> | undefined): StepKey | undefined {
  const k = hint?.key
  return k && typeof k === 'object' && typeof (k as StepKey).from === 'string' ? (k as StepKey) : undefined
}

/** 值显示成一行：字符串加引号，其余 JSON */
export function showValue(v: unknown) {
  if (v === undefined || v === null) return ''
  return typeof v === 'string' ? `"${v}"` : JSON.stringify(v)
}

/** 来源的中文名（徽标上显示） */
export function sourceLabel(src: string | undefined, list: boolean | undefined) {
  switch (src) {
    case 'item':
      return t('数据对象')
    case 'itemLua':
      return t('数据对象的 Lua')
    case 'self':
      return t('条目控件')
    case 'lua':
      return t('条目控件的 Lua')
    case 'text':
      return t('文字')
    case 'row':
    case 'col':
      return t('行列')
    case '':
    case undefined:
      return list ? t('数据对象') : t('条目控件')
    default:
      return src
  }
}

/** 用某个条件改写 target：把 from 前缀换成 base[cond]（cond 空 = 按位置 pos）。前缀对不上返回 undefined */
export function applyKey(target: string, key: StepKey, cond: string | undefined) {
  if (!key.from || !target.startsWith(key.from)) return undefined
  const from = cond ? `${key.base}[${cond}]` : key.pos
  return { target: from + target.slice(key.from.length), from }
}

/** 规则存的字段：条件 `Data.ItemId=1001,@lua.Slot=3` → `["Data.ItemId", "@lua.Slot"]` */
export function fieldsOfCond(cond: string) {
  return cond
    .split(',')
    .map((p) => p.split('=')[0]?.trim() ?? '')
    .filter(Boolean)
}

/** hint.key.by 的中文（步骤详情、录制中的步骤列表、规则面板都用） */
export function byLabel(by: string) {
  if (by === 'auto') return t('录制时自动挑的')
  if (by === 'rule') return t('按规则')
  if (by === 'same') return t('沿用同一列表的')
  if (by === 'user') return t('你选的')
  if (by === 'pending') return t('待定')
  if (by === 'index') return t('只按第几个')
  if (by === 'text') return t('先按文字找')
  return by
}

/** 同一列表（条目类 + 容器）：和 GameTest 录制器、规则一样，类名带不带 _C 算同一个，不分大小写 */
export function listIdOf(k: StepKey) {
  const entry = (k.entry ?? '').replace(/_C$/, '')
  return entry ? `${entry}|${k.base}`.toLowerCase() : ''
}

/**
 * 录完以后按字段给另一步拼条件：用那一步录制时存下的候选（hint.key.cands）里同名字段的值。
 * 候选里没有某个字段（录制时排在后面没存）就拼不出，返回 undefined。
 */
export function condFromCands(k: StepKey, fields: string[]) {
  const parts: string[] = []
  for (const f of fields) {
    const c = (k.cands ?? []).find((x) => !x.combo && x.cond && x.by.toLowerCase() === f.toLowerCase())
    if (!c?.cond) return undefined
    parts.push(c.cond)
  }
  return parts.length ? parts.join(',') : undefined
}

/** gt.record.key 的返回（GameTest 1.5.0 起有 applied / skipped） */
export interface KeyAnswer {
  step: number
  target: string
  by: string
  cond?: string
  rule?: boolean
  ruleError?: string
  resumed?: boolean
  applied?: number
  skipped?: { step: number; why: string }[]
}

/**
 * 录制时存下的全部字段（GameTest 1.6.0 的 hint.fields）在网页里筛：和 gt.keys 的 filter 一样按字段名或显示值，
 * 不分大小写。缓存是全量的，筛完不用再分页。
 */
export function filterKeys(data: KeysResult, filter: string): KeysResult {
  const q = filter.trim().toLowerCase()
  if (!q) return data
  const hit = (f: KeyField) =>
    f.by.toLowerCase().includes(q) || (typeof f.v === 'string' ? f.v : showValue(f.v)).toLowerCase().includes(q)
  const groups = data.groups.map((g) => ({ ...g, fields: g.fields.filter(hit) })).filter((g) => g.fields.length)
  const count = groups.reduce((n, g) => n + g.fields.length, 0)
  return { ...data, groups, total: count, count, hasMore: false, truncated: false }
}
