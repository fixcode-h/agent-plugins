import { readFile } from 'node:fs/promises'
import { BridgeError } from '../instances.ts'
import { t } from '../util.ts'
import { scenarioRoot } from './gt-disk.ts'
import { scenarioFile } from './gt-paths.ts'

const PHASES = ['setup', 'steps', 'teardown'] as const
/** 块里的子步骤槽：大纲只要顶层这一步，子步骤不带（长脚本也回得短） */
const SLOTS = new Set(['do', 'then', 'else', 'elif', 'cases', 'branches'])

/**
 * 对话里跑着的 GameTest 卡片要把还没跑到的步骤也列出来（用户 2026-11-27：下一步要执行的也显示，跑完才打勾）：
 * 读场景文件，按三段回顶层步骤（只留显示名称用的字段）。scenario 是 Agent 调 run 时写的相对场景根的路径，可以不带 .json
 */
export async function scenarioOutline(projectRoot: string, scenario: string) {
  const rel = /\.json$/i.test(scenario) ? scenario : `${scenario}.json`
  const f = scenarioFile(projectRoot, await scenarioRoot(projectRoot), rel)
  const text = await readFile(f.abs, 'utf8').catch(() => {
    throw new BridgeError(t('场景文件不存在：{p}', { p: f.rel }))
  })
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(text.replace(/^﻿/, ''))
  } catch (e) {
    throw new BridgeError(t('不是合法的 JSON：{p}（{e}）', { p: f.rel, e: (e as Error).message }))
  }
  const out: Partial<Record<(typeof PHASES)[number], Record<string, unknown>[]>> = {}
  for (const k of PHASES) {
    const list = Array.isArray(doc[k]) ? (doc[k] as unknown[]) : []
    out[k] = list.map((s) =>
      s && typeof s === 'object' && !Array.isArray(s)
        ? Object.fromEntries(Object.entries(s).filter(([key]) => !SLOTS.has(key)))
        : {},
    )
  }
  return { path: f.rel, ...out }
}
