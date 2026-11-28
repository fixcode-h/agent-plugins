import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hasAction } from '../../../shared/gt-script/expand/map-action.ts'
import { serialize } from '../../../shared/gt-script/script.ts'
import type { GtScript } from '../../../shared/gt-script/types.ts'
import type { UeProject } from '../../types.ts'
import { scenarioRoot } from '../gt-disk.ts'
import { within } from '../gt-paths.ts'

/**
 * 存盘、运行前的脚本展开（接口 + 注册表）：执行 GM（gm.run 按 GM 库生成 run）、对象调用（obj.do 按 ops 生成 run）、
 * 脚本函数（lua / luafn 带上函数库里用到的函数）。这些东西 GameTest 不读（GM 库、函数库在面板这边），
 * 所以展开只能在面板做；一种一个展开器，存盘（ext/gt/file）、跑场景前、临时步骤三处都走这里
 */
export interface ExpandIssue {
  at: string
  message: string
}

export interface ScriptExpander {
  id: string
  /** 脚本里出现这些动作才展开（按原文找 `"动作"`，没有的脚本不读库） */
  actions: string[]
  expand: (doc: GtScript, p: UeProject) => Promise<{ doc: GtScript; issues: ExpandIssue[] }>
}

const expanders: ScriptExpander[] = []

export function registerScriptExpander(e: ScriptExpander) {
  const i = expanders.findIndex((x) => x.id === e.id)
  if (i >= 0) expanders[i] = e
  else expanders.push(e)
}

const wanted = (text: string) => expanders.filter((e) => e.actions.some((a) => hasAction(text, a)))

/** 一份脚本 → 展开后的（没变时原样返回同一个对象）和展开不了的地方 */
export async function expandDoc(p: UeProject, doc: GtScript, text = JSON.stringify(doc)) {
  let cur = doc
  const issues: ExpandIssue[] = []
  for (const e of wanted(text)) {
    const r = await e.expand(cur, p)
    cur = r.doc
    issues.push(...r.issues)
  }
  return { doc: cur, issues }
}

/** 一份脚本原文 → 展开后的原文（没变时原样返回同一段文字）和展开不了的地方 */
export async function expandScriptText(p: UeProject, text: string): Promise<{ text: string; issues: ExpandIssue[] }> {
  if (!wanted(text).length) return { text, issues: [] }
  let doc: GtScript
  try {
    doc = JSON.parse(text) as GtScript
  } catch {
    return { text, issues: [] }
  }
  const r = await expandDoc(p, doc, text)
  return { text: r.doc === doc ? text : serialize(r.doc), issues: r.issues }
}

/**
 * 跑场景前（gt.run 带 scenario / scenarios）：GM 库、函数库在上次存盘之后改过时，先把场景文件重新展开写回，
 * GameTest 读到的就是最新的。不用展开、展开结果没变的文件不动；读写出错不拦运行（照旧跑文件里存的）
 */
export async function refreshBeforeRun(p: UeProject, args: Record<string, unknown>) {
  const names = [args.scenario, ...(Array.isArray(args.scenarios) ? args.scenarios : [])].filter(
    (x): x is string => typeof x === 'string' && !!x,
  )
  if (!names.length) return
  const root = await scenarioRoot(p.root)
  for (const name of names) {
    const abs = path.resolve(root, /\.json$/i.test(name) ? name : `${name}.json`)
    if (!within(root, abs)) continue
    const text = await readFile(abs, 'utf8').catch(() => '')
    if (!wanted(text).length) continue
    const r = await expandScriptText(p, text.replace(/^﻿/, '')).catch(() => undefined)
    if (r && r.text !== text) await writeFile(abs, r.text, 'utf8').catch(() => undefined)
  }
}

/**
 * 临时步骤（gt.step 的 step、gt.run 的 steps：「试这个节点」、Agent 跑临时步骤）当场展开，
 * 展开时加进来的对象并进 args.objects。展开不了的直接报错：单步就是为了马上看到结果
 */
export async function expandInline(p: UeProject, op: string, args: Record<string, unknown>) {
  const key = op === 'gt.step' ? 'step' : op === 'gt.run' && Array.isArray(args.steps) ? 'steps' : ''
  if (!key) return
  const text = JSON.stringify(args[key] ?? null)
  if (!wanted(text).length) return
  const steps = (key === 'step' ? [args[key]] : args[key]) as GtScript['steps']
  const r = await expandDoc(p, { steps, objects: (args.objects ?? {}) as Record<string, unknown> }, text)
  if (r.issues.length) throw new Error(r.issues.map((i) => i.message).join('；'))
  args[key] = key === 'step' ? r.doc.steps?.[0] : r.doc.steps
  if (r.doc.objects && Object.keys(r.doc.objects).length) args.objects = r.doc.objects
}
