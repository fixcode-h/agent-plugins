import { readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ocrInstalled, ocrPng } from '../ocr/engine.ts'
import { pickLabel } from '../ocr/pick.ts'
import { dirSize } from '../ocr/files.ts'
import { t } from '../util.ts'
import { outputRoot } from './gt-disk.ts'
import { insideProject, scenarioFile, within } from './gt-paths.ts'

/**
 * GameTest 录制截图（GameTest 1.3.2 写进步骤的 hint.shot / hint.screen）在面板这边的事：
 * - 录完对每张截图跑 OCR，挑出红框里的字写进 hint.ocr（只显示和给 AI 参考，不写 hint.text：回放按 text 比较，认错一个字就找不回控件）；
 * - 删除截图：一个场景引用的，或这个项目的全部（Saved/<输出目录>/shots）。
 * 截图在 UE 的后台线程里存盘，刚停止录制时最后几张可能还没写完，所以缺图时等一会儿再看。
 */
type Hint = Record<string, unknown>
type Step = Record<string, unknown> & { hint?: Hint }

const hintOf = (s: unknown): Hint | undefined => {
  const h = (s as Step | undefined)?.hint
  return h && typeof h === 'object' && !Array.isArray(h) ? h : undefined
}

async function readSteps(abs: string, rel: string) {
  const text = await readFile(abs, 'utf8').catch(() => {
    throw new Error(t('场景文件不存在：{p}（可能刚被改名或删掉，刷新一下列表）', { p: rel }))
  })
  const doc = JSON.parse(text.replace(/^﻿/, '')) as Record<string, unknown>
  const steps: Step[] = []
  collectSteps(doc.steps, steps)
  return { doc, steps }
}

/**
 * 场景里所有的步骤，连块里的一起（GameTest 1.10.0 起录制可以装成步骤段、接着录的段插在块里）：
 * 有 action 的对象算一步，往它的数组字段里接着找（do / then / else / elif 的每一项）；hint 是线索不是步骤，不进去找
 */
function collectSteps(v: unknown, out: Step[]) {
  if (!Array.isArray(v)) return
  for (const item of v) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const o = item as Step
    if (typeof o.action === 'string') out.push(o)
    for (const [k, child] of Object.entries(o)) if (k !== 'hint' && Array.isArray(child)) collectSteps(child, out)
  }
}

const waitFile = async (file: string, ms: number) => {
  for (let waited = 0; ; waited += 250) {
    if (
      await stat(file).then(
        (s) => s.size > 0,
        () => false,
      )
    )
      return true
    if (waited >= ms) return false
    await new Promise((r) => setTimeout(r, 250))
  }
}

const isBox = (v: unknown): v is [number, number, number, number] =>
  Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number')

/**
 * 给一个场景的截图补 hint.ocr。force：已经有 ocr 的也重认（换了模型、手动「重新识别」）。
 * 识别完再读一次文件、只改 ocr 这一个字段写回：识别要几秒，这期间用户或 Agent 改了场景也不会被盖掉
 */
export async function ocrScenario(projectRoot: string, b: { root?: unknown; path?: unknown; force?: unknown }) {
  if (!(await ocrInstalled())) return { installed: false, named: 0, total: 0 }
  const f = scenarioFile(projectRoot, String(b.root ?? ''), String(b.path ?? ''))
  const force = b.force === true
  const { steps } = await readSteps(f.abs, f.rel)
  const results = new Map<string, string | undefined>()
  let total = 0
  for (const s of steps) {
    const h = hintOf(s)
    const shot = typeof h?.shot === 'string' ? h.shot : ''
    if (!shot || !isBox(h?.shotBox) || (!force && typeof h?.ocr === 'string') || results.has(shot)) continue
    total++
    const file = insideProject(projectRoot, shot)
    if (!(await waitFile(file, 3000))) continue
    results.set(shot, pickLabel(await ocrPng(file), h.shotBox))
  }
  if (!results.size) return { installed: true, named: 0, total }
  const fresh = await readSteps(f.abs, f.rel)
  let named = 0
  let changed = false
  for (const s of fresh.steps) {
    const h = hintOf(s)
    const shot = typeof h?.shot === 'string' ? h.shot : ''
    if (!h || !results.has(shot)) continue
    const text = results.get(shot)
    if (text) named++
    if (text === h.ocr || (!text && !('ocr' in h))) continue
    if (text) h.ocr = text
    else delete h.ocr
    changed = true
  }
  // UE 写场景用 tab 缩进：照它写回，diff 只有 ocr 那几行
  if (changed) await writeFile(f.abs, JSON.stringify(fresh.doc, null, '\t') + '\n', 'utf8')
  return { installed: true, named, total }
}

/** 截图根：Saved/<输出目录>/shots */
const shotsRoot = async (projectRoot: string) => path.join(await outputRoot(projectRoot), 'shots')

/** 删掉文件后顺手删空了的录制目录（shots/<录制时间>/） */
async function pruneEmpty(dir: string, root: string) {
  if (!within(root, dir)) return
  const left = await readdir(dir).catch(() => undefined)
  if (left && !left.length) await rmdir(dir).catch(() => undefined)
}

/**
 * 删除录制截图：scope=all 删这个项目的全部；scope=scenario 只删这个场景引用的图（hint 里的路径留着，页面显示「截图已删」）。
 * 只删截图根下的文件，场景里写了别处的路径也不碰
 */
export async function deleteShots(projectRoot: string, b: { scope?: unknown; root?: unknown; path?: unknown }) {
  const root = await shotsRoot(projectRoot)
  if (b.scope === 'all') {
    const size = await dirSize(root)
    await rm(root, { recursive: true, force: true })
    return { size }
  }
  const f = scenarioFile(projectRoot, String(b.root ?? ''), String(b.path ?? ''))
  const { steps } = await readSteps(f.abs, f.rel)
  const files = new Set<string>()
  for (const s of steps) {
    const h = hintOf(s)
    for (const k of ['shot', 'screen'] as const) {
      const v = h?.[k]
      if (typeof v !== 'string' || !v) continue
      const abs = path.resolve(projectRoot, v)
      if (within(root, abs)) files.add(abs)
    }
  }
  let size = 0
  const dirs = new Set<string>()
  for (const file of files) {
    size += (await stat(file).catch(() => undefined))?.size ?? 0
    await rm(file, { force: true })
    dirs.add(path.dirname(file))
  }
  for (const d of dirs) await pruneEmpty(d, root)
  return { size, files: files.size }
}

/** GameTest 页「录制截图」菜单上的占用大小 */
export async function shotsSize(projectRoot: string) {
  return { size: await dirSize(await shotsRoot(projectRoot)) }
}
