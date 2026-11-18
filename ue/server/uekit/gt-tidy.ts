import { createHash } from 'node:crypto'
import { copyFile, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { t } from '../util.ts'
import { applyTidyDoc, parseTidyPlan } from './gt-tidy-plan.ts'
import { flowifyHints } from './gt-flowify/index.ts'
import { prepareGlobalGuards, withFlow } from './gt-tidy-write.ts'
import { scenarioFile } from './gt-paths.ts'
import { tidyScope } from './gt-tidy-scope.ts'

/**
 * GameTest 页「AI 整理」：把录制交给 Agent 改成真正的测试步骤（去掉多余步骤、补中文说明，按项目代码判断步骤合不合理）。
 *
 * - 2026-11-17 起在项目里开一个 AI 分析对话（runPromptInProject），Agent 回一个 ```gametest-tidy 代码块：
 *   以原步骤为基准的改动列表（gt-tidy-plan.ts），在对话右侧的应用面板里逐条勾选，用户点应用才写回场景文件。
 * - 出题时记下场景文件的 hash（source），应用时核对：这期间场景被改过（重新录制、手改），步骤号就对不上了，拒绝并让用户重新整理。
 * - 写回前把原场景备份成同目录的 <文件名>.json.bak（不是 .json，不会被当成场景）；已经有备份时不覆盖，留的始终是最早的原录制。
 */
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
  const backup = `${f.abs}.bak`
  const backupRel = `${f.rel}.bak`
  const readOrig = () =>
    readText(f.abs).catch(() => {
      throw new Error(t('场景文件不存在：{p}', { p: f.rel }))
    })

  switch (action) {
    case 'status':
      return { backup: (await exists(backup)) ? backupRel : '' }
    case 'source': {
      // 出题：原步骤、文件 hash 和几个绝对路径（提示词里给 Agent 读文件、看截图用）
      const text = await readOrig()
      const doc = parseJson(text, t('原场景'))
      const scope = tidyScope(doc, typeof b.segment === 'string' ? b.segment : undefined)
      return {
        hash: sha1(text),
        name: typeof doc.name === 'string' ? doc.name : '',
        steps: scope.steps,
        ...(scope.segment ? { segment: scope.segment } : {}),
        scenarioPath: slash(f.abs),
        root: slash(f.rootAbs),
        rel: f.rel,
        projectRoot: slash(projectRoot),
        backup: (await exists(backup)) ? backupRel : '',
        // 「整理成流程」的规则建议（gt-flowify）：提示词里交给 Agent 参考，它判断后写进方案
        hints: await flowifyHints(scope.steps, f.rootAbs, f.abs),
      }
    }
    case 'apply': {
      const text = await readOrig()
      if (sha1(text) !== String(b.hash ?? ''))
        throw new Error(t('场景文件在整理之后被改过（{p}），步骤号对不上了：重新点「整理成流程」', { p: f.rel }))
      const orig = parseJson(text, t('原场景'))
      const scope = tidyScope(orig, typeof b.segment === 'string' ? b.segment : undefined)
      const steps = scope.steps
      let plan
      try {
        plan = parseTidyPlan(b.plan, steps.length)
      } catch (e) {
        throw new Error(t('整理方案不对：{e}', { e: (e as Error).message }), { cause: e })
      }
      const picked = Array.isArray(b.picked) ? b.picked.filter((x): x is number => typeof x === 'number') : []
      const out = applyTidyDoc(steps, plan, picked, b.notes === true)
      const next = out.steps
      if (!next.length) throw new Error(t('应用后一步都不剩了，不能保存'))
      const merged = mergeScenario(orig, withFlow(orig, { ...out, steps: scope.put(next) }))
      // 全局守护写进 _settings.json：先读好、查好，场景写成功了再落盘，免得只写了一半
      const commitSettings = out.globalGuards.length
        ? await prepareGlobalGuards(f.rootAbs, out.globalGuards)
        : undefined
      const keptOld = await exists(backup)
      if (!keptOld) await copyFile(f.abs, backup)
      // UE 写场景用 tab 缩进，照它写
      await writeFile(f.abs, JSON.stringify(merged, null, '\t') + '\n', 'utf8')
      const settings = commitSettings ? await commitSettings() : ''
      return {
        ...(settings ? { settings } : {}),
        path: f.rel,
        steps: next.length,
        hash: sha1(JSON.stringify(merged, null, '\t') + '\n'),
        backup: backupRel,
        keptOldBackup: keptOld,
      }
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
