import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { UeProject } from '../types.ts'
import { expandScript, type ExpandIssue, type GmLib } from '../../shared/gt-script/gm/expand.ts'
import { serialize } from '../../shared/gt-script/script.ts'
import type { GtScript } from '../../shared/gt-script/types.ts'
import { luaCall } from '../lua-gm/call.ts'
import { current } from '../lua-gm/scan.ts'
import { readGm } from '../store.ts'
import { t } from '../util.ts'
import { scenarioRoot } from './gt-disk.ts'
import { within } from './gt-paths.ts'

/**
 * 存盘、运行前把脚本里的「执行 GM」（gm.run）按 GM 库重新展开（shared/gt-script/gm/expand.ts）。
 * GM 库在面板这边（gm.json、Lua GM 扫描），GameTest 不读它，所以展开只能在这里做。
 * 没有 gm.run 的脚本不读 GM 库、原样返回
 */
export async function gmLib(p: UeProject): Promise<GmLib> {
  const gm = await readGm(p)
  // Lua GM 的扫描要读脚本文件：只在真有 Lua GM 时用到，出错留着到拼代码时再报
  let scan: Awaited<ReturnType<typeof current>> | undefined
  let scanError = ''
  try {
    scan = await current(p)
  } catch (e) {
    scanError = (e as Error).message
  }
  return {
    gm,
    luaCode: (name, args) => {
      const it = scan?.items.find((x) => x.name === name)
      if (!it) return { error: scanError || scan?.error || t('没有这个 Lua GM：{name}（GM 页「Lua」来源里能看到全部）', { name }) }
      try {
        return { code: luaCall(it, args) }
      } catch (e) {
        return { error: t('Lua GM「{name}」：{e}', { name, e: (e as Error).message }) }
      }
    },
  }
}

const hasGm = (text: string) => text.includes('"gm.run"')

/** 一份脚本原文 → 展开后的原文（没变时原样返回同一段文字）和展开不了的地方 */
export async function expandGmText(p: UeProject, text: string): Promise<{ text: string; issues: ExpandIssue[] }> {
  if (!hasGm(text)) return { text, issues: [] }
  let doc: GtScript
  try {
    doc = JSON.parse(text) as GtScript
  } catch {
    return { text, issues: [] }
  }
  const r = expandScript(doc, await gmLib(p))
  return { text: r.doc === doc ? text : serialize(r.doc), issues: r.issues }
}

/**
 * 跑场景前（gt.run 带 scenario / scenarios）：GM 库在上次存盘之后改过时，先把场景文件里的 gm.run 重新展开写回，
 * GameTest 读到的就是最新的 GM。没有 gm.run、展开结果没变的文件不动；读写出错不拦运行（照旧跑文件里存的）
 */
export async function refreshGmBeforeRun(p: UeProject, args: Record<string, unknown>) {
  const names = [args.scenario, ...(Array.isArray(args.scenarios) ? args.scenarios : [])].filter(
    (x): x is string => typeof x === 'string' && !!x,
  )
  if (!names.length) return
  const root = await scenarioRoot(p.root)
  for (const name of names) {
    const abs = path.resolve(root, /\.json$/i.test(name) ? name : `${name}.json`)
    if (!within(root, abs)) continue
    const text = await readFile(abs, 'utf8').catch(() => '')
    if (!hasGm(text)) continue
    const r = await expandGmText(p, text.replace(/^﻿/, '')).catch(() => undefined)
    if (r && r.text !== text) await writeFile(abs, r.text, 'utf8').catch(() => undefined)
  }
}

/**
 * 临时步骤（gt.step 的 step、gt.run 的 steps：「试这个节点」、Agent 跑临时步骤）里的 gm.run 当场展开，
 * 自定义 GM 用到的对象并进 args.objects。展开不了的直接报错：单步就是为了马上看到结果
 */
export async function expandInline(p: UeProject, op: string, args: Record<string, unknown>) {
  const key = op === 'gt.step' ? 'step' : op === 'gt.run' && Array.isArray(args.steps) ? 'steps' : ''
  if (!key || !JSON.stringify(args[key] ?? null).includes('"gm.run"')) return
  const steps = (key === 'step' ? [args[key]] : args[key]) as GtScript['steps']
  const r = expandScript({ steps, objects: (args.objects ?? {}) as Record<string, unknown> }, await gmLib(p))
  if (r.issues.length) throw new Error(r.issues.map((i) => i.message).join('；'))
  args[key] = key === 'step' ? r.doc.steps?.[0] : r.doc.steps
  if (r.doc.objects && Object.keys(r.doc.objects).length) args.objects = r.doc.objects
}
