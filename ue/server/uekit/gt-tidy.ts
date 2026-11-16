import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { t } from '../util.ts'
import { outputRoot } from './gt-disk.ts'
import { scenarioFile } from './gt-paths.ts'

/**
 * GameTest 页「AI 整理」：把录制交给 Agent 改成真正的测试步骤（去掉重复点击、无意义的修饰键、多余的等待，每步写中文说明 note）。
 *
 * - Agent 写的整理稿放在产物目录 Saved/GameTest/tidy/<场景相对路径>，不放场景根：场景根里的 .json 都会被当成场景列出来、批量跑。
 * - 整理稿外面包一层：summary（一句话）、changes（改了哪几步、为什么，步骤号从 1 数），scenario 是整份新场景。
 *   页面拿原场景和 scenario 做步骤差异给人看，用户点保存才落到场景文件。
 * - 保存前把原场景备份成同目录的 <文件名>.json.bak（不是 .json，不会被当成场景）；已经有备份时不覆盖，留的始终是最早的原录制。
 * - 保存时核对原场景在看差异之后没被改过（hash），改过就让用户重新看，不拿旧差异覆盖新内容。
 */

/** 整理稿里的一条改动说明：原场景第几步变成了新场景第几步（都从 1 数，删掉的 to 为空） */
export interface TidyChange {
  what: string
  from?: number[]
  to?: number[]
}

const exists = (p: string) =>
  stat(p).then(
    (s) => s.isFile(),
    () => false,
  )

const slash = (p: string) => p.replace(/\\/g, '/')
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex')
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

async function readText(abs: string) {
  return (await readFile(abs, 'utf8')).replace(/^﻿/, '')
}

function parseJson(text: string, what: string) {
  try {
    const v = JSON.parse(text) as unknown
    if (isObj(v)) return v
  } catch (e) {
    throw new Error(t('{w}不是合法的 JSON：{e}', { w: what, e: (e as Error).message }))
  }
  throw new Error(t('{w}不是 JSON 对象', { w: what }))
}

const nums = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0) : undefined

/**
 * 读整理稿：认外面包一层的写法，Agent 直接写了整份场景（有 steps 没有 scenario）也收下，只是没有改动说明。
 * 只做形状检查；动作名和字段对不对由页面拿 gt.actions 核对（要编辑器开着）
 */
export function parseDraft(doc: Record<string, unknown>) {
  const scenario = isObj(doc.scenario) ? doc.scenario : Array.isArray(doc.steps) ? doc : undefined
  if (!scenario) throw new Error(t('整理稿里没有 scenario（整份新场景）'))
  const steps = scenario.steps
  if (!Array.isArray(steps) || !steps.length) throw new Error(t('整理稿的 scenario 里没有步骤'))
  const bad = steps.findIndex((s) => !isObj(s) || typeof s.action !== 'string' || !s.action)
  if (bad >= 0) throw new Error(t('整理稿第 {n} 步没有 action', { n: bad + 1 }))
  const changes: TidyChange[] = Array.isArray(doc.changes)
    ? doc.changes.filter(isObj).map((c) => ({
        what: typeof c.what === 'string' ? c.what : '',
        from: nums(c.from),
        to: nums(c.to),
      }))
    : []
  return {
    summary: typeof doc.summary === 'string' ? doc.summary : '',
    changes: changes.filter((c) => c.what),
    scenario: scenario as Record<string, unknown> & { steps: Record<string, unknown>[] },
  }
}

/**
 * 写回的新场景：顶层以原场景为底（kind、tags、schemaVersion 这些整理稿里可能没写），整理稿的字段盖上去，
 * revision 加 1；schemaVersion 取两边大的；name 保持原名（文件名跟着它，改名走右键「改名」）
 */
export function mergeScenario(orig: Record<string, unknown>, draft: Record<string, unknown>): Record<string, unknown> {
  const rev = typeof orig.revision === 'number' ? orig.revision : 0
  const v = (x: unknown) => (typeof x === 'number' ? x : 0)
  // 版本只升不降：schemaVersion 1 里 click 默认是代码点击，整理稿没写版本时照原样，不悄悄改了旧步骤的点法
  const version = Math.max(v(orig.schemaVersion) || 1, v(draft.schemaVersion))
  return {
    ...orig,
    ...draft,
    kind: 'gametest-scenario',
    schemaVersion: version,
    name: orig.name ?? draft.name,
    revision: rev + 1,
  }
}

export async function tidyAction(projectRoot: string, b: Record<string, unknown>) {
  const action = String(b.action ?? '')
  const f = scenarioFile(projectRoot, String(b.root ?? ''), String(b.path ?? ''))
  const draft = path.join(await outputRoot(projectRoot), 'tidy', f.rel)
  const backup = `${f.abs}.bak`
  const backupRel = `${f.rel}.bak`

  switch (action) {
    case 'status':
      return { draft: await exists(draft), backup: (await exists(backup)) ? backupRel : '' }
    case 'prepare':
      // 交给 Agent 前清掉上一次的整理稿，页面看到的一定是这次写的
      await rm(draft, { force: true })
      await mkdir(path.dirname(draft), { recursive: true })
      return { draftPath: slash(draft), scenarioPath: slash(f.abs) }
    case 'discard':
      await rm(draft, { force: true })
      return { draft: false }
    case 'load': {
      if (!(await exists(draft))) throw new Error(t('还没有整理稿：Agent 写好后再看'))
      const origText = await readText(f.abs).catch(() => {
        throw new Error(t('场景文件不存在：{p}', { p: f.rel }))
      })
      const orig = parseJson(origText, t('原场景'))
      const d = parseDraft(parseJson(await readText(draft), t('整理稿')))
      return {
        hash: sha1(origText),
        original: Array.isArray(orig.steps) ? orig.steps : [],
        schemaVersion: typeof orig.schemaVersion === 'number' ? orig.schemaVersion : 1,
        ...d,
        backup: (await exists(backup)) ? backupRel : '',
      }
    }
    case 'apply': {
      const origText = await readText(f.abs)
      if (sha1(origText) !== String(b.hash ?? ''))
        throw new Error(t('场景文件在这期间被改过（{p}），重新打开整理结果看一遍再保存', { p: f.rel }))
      const d = parseDraft(parseJson(await readText(draft), t('整理稿')))
      const merged = mergeScenario(parseJson(origText, t('原场景')), d.scenario)
      const keptOld = await exists(backup)
      if (!keptOld) await copyFile(f.abs, backup)
      // UE 写场景用 tab 缩进，照它写
      await writeFile(f.abs, JSON.stringify(merged, null, '\t') + '\n', 'utf8')
      await rm(draft, { force: true })
      return { path: f.rel, steps: d.scenario.steps.length, backup: backupRel, keptOldBackup: keptOld }
    }
    case 'restore': {
      if (!(await exists(backup))) throw new Error(t('没有原录制的备份：{p}', { p: backupRel }))
      await copyFile(backup, f.abs)
      await rm(backup, { force: true })
      return { path: f.rel }
    }
    default:
      throw new Error(t('不认识的整理操作：{a}', { a: action }))
  }
}
