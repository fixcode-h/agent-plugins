import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BridgeError } from '../instances.ts'
import { t } from '../util.ts'
import { insideProject, within } from './gt-paths.ts'
import { cloneDoc, placeOfEdit, slotOf } from './gt-slot/slot.ts'

/**
 * 列表、格子条目「怎么认」（GameTest 1.4.0 起）在面板侧读写文件的部分：
 * - 规则（场景根 `_settings.json` 的 itemKeys）：规则面板直接读写磁盘，编辑器没开也能整理；
 *   UE 那边按文件时间重读，改完下次录制就用上。只动 itemKeys，别的运行配置原样保留。
 * - 条目字段缓存（GameTest 1.6.0 录制时存的 hint.fields）：「换一个标识」在游戏没跑时用它列字段。
 * - 一次改好几步（replaceMany）：步骤详情「同一列表的其他步骤一起改」，每一步都核对没被改过再一起写。
 */

export interface KeyRule {
  entry: string
  container?: string
  by: string[]
}

const stripC = (s: string) => (s.endsWith('_C') ? s.slice(0, -2) : s).toLowerCase()
/** 和 GameTest 的 GameTestKeyRules::Save 一样：条目类（带不带 _C）+ 容器相同算同一条 */
const sameRule = (a: KeyRule, b: KeyRule) =>
  stripC(a.entry) === stripC(b.entry) && (a.container ?? '').toLowerCase() === (b.container ?? '').toLowerCase()

function tidy(raw: unknown): KeyRule | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const entry = typeof r.entry === 'string' ? r.entry.trim() : ''
  const by = Array.isArray(r.by) ? r.by.filter((x): x is string => typeof x === 'string').map((x) => x.trim()) : []
  const container = typeof r.container === 'string' ? r.container.trim() : ''
  if (!entry || !by.filter(Boolean).length) return undefined
  return { entry, ...(container ? { container } : {}), by: by.filter(Boolean) }
}

async function readSettings(file: string): Promise<Record<string, unknown>> {
  const text = await readFile(file, 'utf8').catch(() => '')
  if (!text.trim()) return {}
  try {
    const doc = JSON.parse(text.replace(/^﻿/, '')) as unknown
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) return doc as Record<string, unknown>
  } catch {
    // 落到下面统一报错
  }
  throw new BridgeError(t('运行配置 _settings.json 不是合法的 JSON，先在 GameTest 设置里修好再改规则'))
}

/** POST ext/gt/keyrules：action = read / write（整份换掉）/ upsert（加一条，同条目类 + 容器的旧规则换掉） */
export async function keyRulesAction(projectRoot: string, b: Record<string, unknown>) {
  const root = String(b.root ?? '')
  if (!root) throw new BridgeError(t('不知道场景根在哪：先刷新 GameTest 页'))
  const file = path.join(insideProject(projectRoot, root), '_settings.json')
  const doc = await readSettings(file)
  const current = (Array.isArray(doc.itemKeys) ? doc.itemKeys : []).map(tidy).filter((r): r is KeyRule => !!r)
  const action = String(b.action ?? 'read')
  if (action === 'read') return { rules: current }

  let next: KeyRule[]
  if (action === 'write') {
    if (!Array.isArray(b.rules)) throw new BridgeError(t('缺 rules'))
    next = b.rules.map(tidy).filter((r): r is KeyRule => !!r)
  } else if (action === 'upsert') {
    const rule = tidy(b.rule)
    if (!rule) throw new BridgeError(t('规则要有条目类名和至少一个字段'))
    next = [...current.filter((r) => !sameRule(r, rule)), rule]
  } else {
    throw new BridgeError(t('不认识的操作：{a}', { a: action }))
  }
  const out = { ...doc }
  if (next.length) out.itemKeys = next
  else delete out.itemKeys
  await writeFile(file, JSON.stringify(out, null, '\t') + '\n', 'utf8')
  return { rules: next }
}

/** 场景文件里一次改好几步：edits = [{index, expect, step}]，任何一步和 expect 对不上就整个不写 */
export async function replaceMany(abs: string, rel: string, doc: Record<string, unknown>, b: Record<string, unknown>) {
  const edits = Array.isArray(b.edits) ? (b.edits as Record<string, unknown>[]) : []
  if (!edits.length) throw new BridgeError(t('缺 edits'))
  // 一份拷贝上改完再写：几步里有一步对不上就整份不写
  const out = cloneDoc(doc)
  // 和 replaceSteps 一样：网页拿到的步骤整理过（action 排最前），字段顺序不同不算改过
  const same = (x: unknown) => JSON.stringify(x && typeof x === 'object' ? { action: '', ...x } : x)
  for (const e of edits) {
    // path：录制段里的步骤（steps.1.steps.3）；旧网页只给顶层序号 index
    const at = placeOfEdit(e)
    const steps = slotOf(out, at.slot)
    if (
      !Number.isInteger(at.index) ||
      at.index < 0 ||
      at.index >= steps.length ||
      !e.step ||
      typeof e.step !== 'object'
    )
      throw new BridgeError(t('改步骤缺参数：index、expect、step'))
    if (same(steps[at.index]) !== same(e.expect))
      throw new BridgeError(t('场景文件在这期间被改过（{p}），刷新后再试', { p: rel }))
    steps[at.index] = e.step as Record<string, unknown>
  }
  const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1
  await writeFile(abs, JSON.stringify({ ...out, schemaVersion: Math.max(version, 2) }, null, '\t') + '\n', 'utf8')
  return { path: rel, steps: Array.isArray(out.steps) ? out.steps.length : 0, changed: edits.length }
}

/** 一个条目的字段缓存最多几十 KB；比这大的多半不是我们写的文件 */
const KEY_FIELDS_MAX_BYTES = 4 * 1024 * 1024

/** POST ext/gt/keyfields：读录制时存的条目全部字段（Saved/<输出目录>/keys/…json，和 gt.keys 的返回同形状） */
export async function readKeyFields(projectRoot: string, rel: string) {
  const abs = insideProject(projectRoot, rel)
  if (!/\.json$/i.test(abs) || !within(path.join(projectRoot, 'Saved'), abs))
    throw new BridgeError(t('只能读 Saved 里的条目字段缓存：{p}', { p: rel }))
  const size = (await stat(abs).catch(() => undefined))?.size
  if (size === undefined)
    throw new BridgeError(t('录制时存的字段文件没了（{p}）：开游戏、打开那个界面再挑', { p: rel }))
  if (size > KEY_FIELDS_MAX_BYTES) throw new BridgeError(t('字段缓存文件太大，不像是录制时存的：{p}', { p: rel }))
  try {
    const doc = JSON.parse((await readFile(abs, 'utf8')).replace(/^\uFEFF/, '')) as Record<string, unknown>
    if (!doc || !Array.isArray(doc.groups)) throw new Error('groups')
    return doc
  } catch {
    throw new BridgeError(t('字段缓存文件读不了（{p}）：开游戏、打开那个界面再挑', { p: rel }))
  }
}
