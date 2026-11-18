import { copyFile, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BridgeError } from '../instances.ts'
import { revealInFolder } from '../reveal.ts'
import { t } from '../util.ts'
import { replaceMany } from './gt-keys.ts'
import { insideProject, scenarioFile, within } from './gt-paths.ts'

export { insideProject }

/**
 * GameTest 场景文件的面板侧操作（GameTest 页的步骤列表和右键菜单）。场景是项目文档根里给人看和改的 JSON，
 * 面板和 UE 在同一台机器上，直接读写文件就行，不用经 UE：UE 没提供「读一个场景」的操作，
 * 而且云端编不了 C++，读文件这种事放面板这边，GameTest 不用为了它发版。
 */

/** 一步：action 必有，其余字段按动作不同（target、note、map、key……） */
export interface ScenarioStep {
  action: string
  [k: string]: unknown
}

export interface ScenarioDoc {
  name?: string
  _note?: string
  stepDelayMs?: number
  schemaVersion?: number
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
    schemaVersion: typeof doc.schemaVersion === 'number' ? doc.schemaVersion : undefined,
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
 * 把第 index 步起的几步换成新的步骤（GameTest 页「转成控件步骤」、步骤右键的插入和删除、「回放怎么认」）。expect 是网页看到的原步骤：文件在这期间被改过
 * （重新录制、Agent 改了）就对不上，报错让用户刷新，不按行号硬改。
 * 新步骤是 GameTest 1.1 的写法（click 走真实指针）：schemaVersion 1 的文件顺带升到 2，并给原有没写 via 的
 * click / type 补上 via:"code"——和 GameTest 读 v1 文件时做的一样，旧步骤行为不变
 */
async function replaceSteps(abs: string, rel: string, doc: Record<string, unknown>, b: Record<string, unknown>) {
  const steps = Array.isArray(doc.steps) ? [...(doc.steps as Record<string, unknown>[])] : []
  const index = Number(b.index)
  const expect = Array.isArray(b.expect) ? b.expect : []
  const next = Array.isArray(b.steps) ? (b.steps as Record<string, unknown>[]) : []
  // steps 可以是空数组：步骤右键「删除这一步」；插入新步骤是把原步骤换成 [新步骤, 原步骤] 或 [原步骤, 新步骤]
  if (!Number.isInteger(index) || index < 0 || !expect.length || !Array.isArray(b.steps))
    throw new BridgeError(t('替换步骤缺参数：index、expect、steps'))
  // 网页拿到的步骤经过 readScenario 的整理（action 排在最前），这里照样整理再比，字段顺序不同不算改过
  const same = (x: unknown) => JSON.stringify(x && typeof x === 'object' ? { action: '', ...x } : x)
  if (
    steps
      .slice(index, index + expect.length)
      .map(same)
      .join() !== expect.map(same).join()
  )
    throw new BridgeError(t('场景文件在这期间被改过（{p}），刷新后再试', { p: rel }))
  const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1
  const kept =
    version >= 2
      ? steps
      : steps.map((s) => ((s?.action === 'click' || s?.action === 'type') && !('via' in s) ? { ...s, via: 'code' } : s))
  kept.splice(index, expect.length, ...next)
  await writeFile(
    abs,
    JSON.stringify({ ...doc, schemaVersion: Math.max(version, 2), steps: kept }, null, '\t') + '\n',
    'utf8',
  )
  return { path: rel, steps: kept.length }
}

/**
 * 场景的右键菜单：改名（文件名和场景里的 name 一起改）、复制一份、删除、在文件夹中显示、读原文（raw，复制 / 导出 JSON）；
 * 步骤的「转成控件步骤」（replace）。
 * 删除前网页已经弹窗确认过；同一个目录里重名时报错，不覆盖
 */
export async function scenarioAction(
  projectRoot: string,
  b: { root?: unknown; path?: unknown; action?: unknown; name?: unknown; [k: string]: unknown },
) {
  const action = String(b.action ?? '')
  const f = scenarioFile(projectRoot, String(b.root ?? ''), String(b.path ?? ''), action === 'reveal')
  if (action === 'reveal') {
    if (!(await exists(f.abs))) throw new BridgeError(t('文件不存在：{p}', { p: f.rel || '.' }))
    revealInFolder(f.abs)
    return { path: f.rel }
  }
  if (action === 'raw') {
    // 「复制为 JSON」「导出 JSON」：原文照给（readScenario 会整理步骤、丢掉 kind / tags 这些顶层字段）
    const text = await readFile(f.abs, 'utf8').catch(() => {
      throw new BridgeError(t('场景文件不存在：{p}（可能刚被改名或删掉，刷新一下列表）', { p: f.rel }))
    })
    return { path: f.rel, text: text.replace(/^\uFEFF/, '') }
  }
  if (action === 'delete') {
    await rm(f.abs).catch(() => {
      throw new BridgeError(t('删不掉 {p}：文件不存在或被占用', { p: f.rel }))
    })
    return { path: f.rel }
  }
  const doc = await readDoc(f.abs, f.rel)
  if (action === 'replace') return replaceSteps(f.abs, f.rel, doc, b)
  if (action === 'replaceMany') return replaceMany(f.abs, f.rel, doc as unknown as Record<string, unknown>, b)
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

/** 失败证据里的文字文件最多读多少：日志 100 行、控件快照几千个节点都在这以内，超了截断并说明 */
const EVIDENCE_MAX_BYTES = 256 * 1024

/**
 * GameTest 失败证据里的文字文件（log.txt、widgets.json，在 Saved/GameTest/…/failures/ 下）：步骤详情里展开日志用。
 * 只认 Saved/ 下的 .txt / .log / .json，大文件只读开头一段
 */
export async function readEvidenceText(projectRoot: string, rel: string) {
  const abs = insideProject(projectRoot, rel)
  if (!/\.(txt|log|json)$/i.test(abs) || !within(path.join(projectRoot, 'Saved'), abs))
    throw new BridgeError(t('只能读 Saved 里的 GameTest 证据文件：{p}', { p: rel }))
  const fh = await open(abs, 'r').catch(() => {
    throw new BridgeError(t('文件不存在：{p}', { p: rel }))
  })
  try {
    const size = (await fh.stat()).size
    const buf = Buffer.alloc(Math.min(size, EVIDENCE_MAX_BYTES))
    await fh.read(buf, 0, buf.length, 0)
    return { text: buf.toString('utf8'), size, truncated: size > EVIDENCE_MAX_BYTES }
  } finally {
    await fh.close()
  }
}
