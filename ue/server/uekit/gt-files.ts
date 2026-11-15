import { copyFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BridgeError } from '../instances.ts'
import { revealInFolder } from '../reveal.ts'
import { t } from '../util.ts'

/**
 * GameTest 场景文件的面板侧操作（GameTest 页的步骤列表和右键菜单）。场景是项目文档根里给人看和改的 JSON，
 * 面板和 UE 在同一台机器上，直接读写文件就行，不用经 UE：UE 没提供「读一个场景」的操作，
 * 而且云端编不了 C++，读文件这种事放面板这边，GameTest 不用为了它发版。
 */

/**
 * 只认项目目录和项目外层同级的 ProjectDoc 里的文件（P4 / SVN 项目的文档根在那，AssetForge 配置、GameTest 场景跟着它）。
 * 相对路径按项目根算（gt 报告里的 path 就是这样）
 */
export function insideProject(root: string, rel: string) {
  const abs = path.resolve(root, rel)
  if (!within(root, abs) && !within(path.join(path.dirname(root), 'ProjectDoc'), abs))
    throw new BridgeError(t('只能读项目目录和 ProjectDoc 里的文件：{p}', { p: rel }))
  return abs
}

const within = (dir: string, abs: string) => {
  const r = path.relative(dir, abs)
  return !!r && !r.startsWith('..') && !path.isAbsolute(r)
}

/**
 * 场景根（gt.scenarios 的 absoluteRootDir）下的一个 .json 场景：出了场景根、不是 .json 都拒绝。
 * dir：在文件夹中显示时也认场景根本身和里面的子目录
 */
function scenarioFile(projectRoot: string, scenarioRoot: string, rel: string, dir = false) {
  if (!scenarioRoot) throw new BridgeError(t('不知道场景根在哪：先刷新 GameTest 页'))
  const rootAbs = insideProject(projectRoot, scenarioRoot)
  const abs = path.resolve(rootAbs, rel)
  const ok = dir ? abs === rootAbs || within(rootAbs, abs) : within(rootAbs, abs) && /\.json$/i.test(abs)
  if (!ok) throw new BridgeError(t('只能操作场景根里的 .json 场景：{p}', { p: rel }))
  return { rootAbs, abs, rel: path.relative(rootAbs, abs).replace(/\\/g, '/') }
}

/** 一步：action 必有，其余字段按动作不同（target、note、map、key……） */
export interface ScenarioStep {
  action: string
  [k: string]: unknown
}

export interface ScenarioDoc {
  name?: string
  _note?: string
  stepDelayMs?: number
  steps: ScenarioStep[]
}

async function readDoc(abs: string, rel: string, missing?: string) {
  const text = await readFile(abs, 'utf8').catch(() => {
    throw new BridgeError(missing ?? t('场景文件不存在：{p}（可能刚被改名或删掉，刷新一下列表）', { p: rel }))
  })
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(text.replace(/^﻿/, '')) as Record<string, unknown>
  } catch (e) {
    throw new BridgeError(t('不是合法的 JSON：{p}（{e}）', { p: rel, e: (e as Error).message }))
  }
  return doc
}

/** 读一个场景的全部步骤：没跑过的场景也能在页面上列出每一步 */
export async function readScenario(projectRoot: string, scenarioRoot: string, rel: string): Promise<ScenarioDoc> {
  const f = scenarioFile(projectRoot, scenarioRoot, rel)
  const doc = await readDoc(f.abs, f.rel)
  const steps = Array.isArray(doc.steps) ? doc.steps : []
  return {
    name: typeof doc.name === 'string' ? doc.name : undefined,
    _note: typeof doc._note === 'string' ? doc._note : undefined,
    stepDelayMs: typeof doc.stepDelayMs === 'number' ? doc.stepDelayMs : undefined,
    steps: steps.map((s) =>
      s && typeof s === 'object' && !Array.isArray(s)
        ? ({ action: '', ...(s as Record<string, unknown>) } as ScenarioStep)
        : { action: '' },
    ),
  }
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

/** 给场景起的新名字落成文件名：去掉文件名里不能用的字符，空的不行 */
function stemOf(name: string) {
  const stem = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .slice(0, 80)
  if (!stem) throw new BridgeError(t('名字不能是空的'))
  return stem
}

/**
 * UE 写场景用 tab 缩进（FJsonSerializer 的 pretty 格式）：照它写回，改名后 diff 只有 name 那一行。
 * 只改顶层的 name，步骤原样保留
 */
async function writeWithName(abs: string, doc: Record<string, unknown>, name: string) {
  await writeFile(abs, JSON.stringify({ ...doc, name }, null, '\t') + '\n', 'utf8')
}

/**
 * 场景的右键菜单：改名（文件名和场景里的 name 一起改）、复制一份、删除、在文件夹中显示。
 * 删除前网页已经弹窗确认过；同一个目录里重名时报错，不覆盖
 */
export async function scenarioAction(
  projectRoot: string,
  b: { root?: unknown; path?: unknown; action?: unknown; name?: unknown },
) {
  const action = String(b.action ?? '')
  const f = scenarioFile(projectRoot, String(b.root ?? ''), String(b.path ?? ''), action === 'reveal')
  if (action === 'reveal') {
    if (!(await exists(f.abs))) throw new BridgeError(t('文件不存在：{p}', { p: f.rel || '.' }))
    revealInFolder(f.abs)
    return { path: f.rel }
  }
  if (action === 'delete') {
    await rm(f.abs).catch(() => {
      throw new BridgeError(t('删不掉 {p}：文件不存在或被占用', { p: f.rel }))
    })
    return { path: f.rel }
  }
  const doc = await readDoc(f.abs, f.rel)
  const dir = path.dirname(f.abs)
  const toRel = (abs: string) => path.relative(f.rootAbs, abs).replace(/\\/g, '/')
  if (action === 'rename') {
    const name = String(b.name ?? '').trim()
    const to = path.join(dir, `${stemOf(name)}.json`)
    if (to.toLowerCase() !== f.abs.toLowerCase() && (await exists(to)))
      throw new BridgeError(t('同一个目录里已经有 {p}，换个名字', { p: toRel(to) }))
    await writeWithName(f.abs, doc, name)
    if (to !== f.abs) await rename(f.abs, to)
    return { path: toRel(to) }
  }
  if (action === 'duplicate') {
    const base = typeof doc.name === 'string' && doc.name ? doc.name : path.basename(f.abs, '.json')
    let n = 1
    let name = t('{name} 副本', { name: base })
    let to = path.join(dir, `${stemOf(name)}.json`)
    while (await exists(to)) {
      n += 1
      name = t('{name} 副本 {n}', { name: base, n })
      to = path.join(dir, `${stemOf(name)}.json`)
    }
    await copyFile(f.abs, to)
    await writeWithName(to, doc, name)
    return { path: toRel(to) }
  }
  throw new BridgeError(t('不认识的场景操作：{a}', { a: action }))
}

/**
 * gt.report 超过 12000 字时 GameTest 把整份报告写进 Saved/GameTest/responses/，只回 file（相对项目根）：
 * 页面要列出每一步的结果，就由面板读这份文件。只认 Saved/ 下的 .json
 */
export async function readReportFile(projectRoot: string, rel: string) {
  const abs = insideProject(projectRoot, rel)
  if (!/\.json$/i.test(abs) || !within(path.join(projectRoot, 'Saved'), abs))
    throw new BridgeError(t('只能读 Saved 里的 GameTest 报告：{p}', { p: rel }))
  return (await readDoc(abs, rel, t('报告文件不存在：{p}', { p: rel }))) as { steps?: unknown[] }
}
