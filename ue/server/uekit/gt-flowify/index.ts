import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { slash, walkJson } from '../gt-library/files.ts'
import { inputParam } from './rules/input-param.ts'
import { popupGuard } from './rules/popup-guard.ts'
import { repeat } from './rules/repeat.ts'
import { sameScript } from './rules/same-script.ts'
import { skipIf } from './rules/skip-if.ts'
import type { FlowHint, FlowRule, LibraryScript, Step } from './types.ts'

export type { FlowHint, FlowRule } from './types.ts'

/**
 * 规则表：按顺序跑，前面的先占步骤（整段换成 call 最省事，其次弹窗守护、循环、分支），参数只改字段不占步骤。
 * 加规则在这里登记一行。
 */
const RULES: FlowRule[] = [sameScript, popupGuard, repeat, skipIf, inputParam]

export function registerFlowRule(rule: FlowRule, before?: string) {
  const at = before ? RULES.findIndex((r) => r.name === before) : -1
  if (at >= 0) RULES.splice(at, 0, rule)
  else RULES.push(rule)
}

export const flowRules = () => RULES.map((r) => ({ name: r.name, summary: r.summary }))

/** 最多给几条：太多了 Agent 和用户都看不过来 */
const MAX_HINTS = 20
/** 比对现成脚本时最多读几个文件（场景库很大时别把出题拖慢） */
const MAX_LIBRARY = 400

export function runFlowRules(steps: Step[], library: LibraryScript[] = []): FlowHint[] {
  const ctx = { steps, library, claimed: new Set<number>() }
  return RULES.flatMap((r) => r.run(ctx)).slice(0, MAX_HINTS)
}

/** 场景根里别的脚本（_ 开头的配置和自己除外） */
export async function loadLibrary(rootAbs: string, selfAbs?: string): Promise<LibraryScript[]> {
  const files = (await walkJson(rootAbs)).filter(
    (f) => !path.basename(f).startsWith('_') && path.resolve(f) !== (selfAbs && path.resolve(selfAbs)),
  )
  const out: LibraryScript[] = []
  for (const f of files.slice(0, MAX_LIBRARY)) {
    try {
      const doc = JSON.parse((await readFile(f, 'utf8')).replace(/^﻿/, '')) as Record<string, unknown>
      if (Array.isArray(doc.steps)) out.push({ rel: slash(path.relative(rootAbs, f)).replace(/\.json$/i, ''), steps: doc.steps as Step[] })
    } catch {
      // 坏文件不是这里的事，场景库会标出来
    }
  }
  return out
}

/** 出题时用：规则建议（读不了场景库也照样给不依赖它的建议） */
export async function flowifyHints(steps: Step[], rootAbs: string, selfAbs?: string) {
  const library = await loadLibrary(rootAbs, selfAbs).catch(() => [])
  return runFlowRules(steps, library)
}
