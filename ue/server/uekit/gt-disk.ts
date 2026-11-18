import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { readIni } from '../editor-tools/config-layers.ts'
import { t } from '../util.ts'

/**
 * 编辑器没开时 GameTest 的只读操作（gt.scenarios / gt.runs / gt.history / gt.report）直接读磁盘：
 * 场景是项目文档根里的 JSON，报告、历史是 Saved/GameTest 下的文件，都是 GameTest 自己写的，面板照它的规则读就行。
 * 用户 2026-11-16：UE 没运行时 GameTest 页也要能看场景、步骤、历史和上次的失败证据，只是不能录制和运行。
 * 规则对照 UEKit 的 GameTestSettings.cpp（场景根）、GameTestShot.cpp（产物根）、GameTestScenario.cpp（校验）、
 * GameTestHistory.cpp（history.json）；返回的字段和 UE 的同名操作一致，页面和 ue_gametest 不用分两套。
 */

// 出错抛普通 Error（消息照样原样显示）：不 import instances.ts，单测不用拉上面板模块
const SECTION = '/Script/GameTest.GameTestSettings'
const KIND = 'gametest-scenario'
const SUPPORTED_SCHEMA = 2
/** 和 UE 的上限一致：默认 4000 字，读结构的 12000 字 */
const STRUCTURE_MAX = 12000
/** 「最近运行」最多列几次：UE 只在内存里留本次会话的，磁盘上按产物目录的时间取最新的这么多 */
const RECENT_RUNS = 30

/** 项目设置 → 插件 → Game Test 的两项（config=Game, defaultconfig，写在 Config/DefaultGame.ini） */
export async function gtRootsFromSetting(root: string) {
  const ini = await readIni(path.join(root, 'Config', 'DefaultGame.ini'))
  const get = (key: string) =>
    (ini?.get(SECTION) ?? [])
      .filter((e) => e.key === key)
      .map((e) => e.value)
      .at(-1)
      ?.trim() ?? ''
  return { scenarioRootDir: get('ScenarioRootDir'), outputDir: get('OutputDir') }
}

const exists = (p: string) =>
  stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  )
const slash = (p: string) => p.replace(/\\/g, '/')

/** 场景根：设置了按设置（相对项目根），没设置时项目外层有 ProjectDoc/docs 用 ProjectDoc/docs/GameTest，否则 docs/GameTest */
export async function scenarioRoot(root: string) {
  const { scenarioRootDir } = await gtRootsFromSetting(root)
  if (scenarioRootDir) return path.resolve(root, scenarioRootDir)
  const sibling = path.resolve(root, '..', 'ProjectDoc', 'docs')
  return path.join((await exists(sibling)) ? sibling : path.join(root, 'docs'), 'GameTest')
}

/** 产物根：Saved/<OutputDir>（默认 Saved/GameTest），报告、截图、history.json 都在这 */
export async function outputRoot(root: string) {
  const { outputDir } = await gtRootsFromSetting(root)
  return path.resolve(root, 'Saved', outputDir || 'GameTest')
}

/** 相对项目根的写法（UE 的 ToProjectRelative），出了项目就给绝对路径 */
function projectRel(root: string, abs: string) {
  const r = path.relative(root, abs)
  return slash(r && !r.startsWith('..') && !path.isAbsolute(r) ? r : abs)
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  const text = await readFile(file, 'utf8').catch(() => undefined)
  if (text === undefined) return undefined
  try {
    const v = JSON.parse(text.replace(/^﻿/, '')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** 和 GameTestScenario::Validate 同一套检查：列表里「看起来能跑」的场景开了编辑器也真能跑 */
function validate(doc: Record<string, unknown>) {
  const errors: string[] = []
  const kind = typeof doc.kind === 'string' ? doc.kind : ''
  if (!kind) errors.push(`缺少必填字段 kind（应为 '${KIND}'）`)
  else if (kind.toLowerCase() !== KIND) errors.push(`kind 应为 '${KIND}'，收到 '${kind}'`)
  const v = doc.schemaVersion
  if (typeof v !== 'number' || !Number.isInteger(v))
    errors.push(`缺少必填字段 schemaVersion（当前支持 ${SUPPORTED_SCHEMA}）`)
  else if (v <= 0) errors.push(`schemaVersion 应为正数，收到 ${v}`)
  else if (v > SUPPORTED_SCHEMA)
    errors.push(`schemaVersion ${v} 高于本插件支持的 ${SUPPORTED_SCHEMA}（升级插件或把场景降到支持的版本）`)
  if (typeof doc.name !== 'string' || !doc.name) errors.push('缺少必填字段 name（场景名，进报告与产物目录）')
  const steps = doc.steps
  if (!Array.isArray(steps) || !steps.length) errors.push('缺少非空的 steps 数组')
  else
    steps.forEach((s, i) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) errors.push(`第 ${i + 1} 步不是 JSON 对象`)
    })
  return errors
}

async function walkJson(dir: string, out: string[]) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) await walkJson(abs, out)
    else if (e.isFile() && /\.json$/i.test(e.name)) out.push(abs)
  }
}

/** gt.scenarios：场景根下全部 .json（按相对路径排序），坏的也列出来并带 parseError */
async function scenarios(root: string, args: Record<string, unknown>) {
  const rootAbs = await scenarioRoot(root)
  const files: string[] = []
  await walkJson(rootAbs, files)
  // _ 开头的是场景根的配置和生成物（_settings.json 运行配置、_vars.json 常用名、_api.json 接口库），不是场景（设计稿 12.1）
  const all = await Promise.all(
    files
      .filter((f) => !path.basename(f).startsWith('_'))
      .map(async (abs) => {
        const relativePath = slash(path.relative(rootAbs, abs))
        const fallback = path.basename(abs, path.extname(abs))
        const doc = await readJson(abs)
        if (!doc)
          return {
            name: fallback,
            relativePath,
            _note: '',
            steps: 0,
            revision: 0,
            tags: [],
            parseError: '不是合法的 JSON',
          }
        const errors = validate(doc)
        const tags = Array.isArray(doc.tags)
          ? doc.tags
              .filter((x): x is string => typeof x === 'string')
              .map((x) => x.trim())
              .filter(Boolean)
          : []
        return {
          name: typeof doc.name === 'string' && doc.name ? doc.name : fallback,
          relativePath,
          _note: typeof doc._note === 'string' ? doc._note : '',
          steps: errors.length ? 0 : (doc.steps as unknown[]).length,
          revision: typeof doc.revision === 'number' ? Math.max(0, Math.trunc(doc.revision)) : 0,
          tags,
          ...(errors.length ? { parseError: errors.join('；') } : {}),
        }
      }),
  )
  all.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0))
  const query = String(args.query ?? '')
  const matched = query ? all.filter((s) => s.name.includes(query) || s.relativePath.includes(query)) : all
  const offset = Math.max(0, Number(args.offset) || 0)
  const limit = Math.min(1000, Math.max(1, Number(args.limit) || 200))
  return {
    rootDir: projectRel(root, rootAbs),
    absoluteRootDir: slash(rootAbs),
    scenarios: matched.slice(offset, offset + limit),
    total: matched.length,
  }
}

const SUMMARY_KEYS = [
  'runId',
  'name',
  'scenario',
  'startedAtUtc',
  'finishedAtUtc',
  'succeeded',
  'revision',
  'durationMs',
  'total',
  'failed',
]

/** 产物目录（<名字>-<时间>），最新的在前：按目录的修改时间排，目录名里的时间是 UTC 不一定好比 */
async function runDirs(outRoot: string) {
  const ents = await readdir(outRoot, { withFileTypes: true }).catch(() => [])
  const dirs = await Promise.all(
    ents
      .filter((e) => e.isDirectory() && e.name !== 'responses')
      .map(async (e) => {
        const abs = path.join(outRoot, e.name)
        return { abs, mtime: (await stat(abs).catch(() => undefined))?.mtimeMs ?? 0 }
      }),
  )
  return dirs.sort((a, b) => b.mtime - a.mtime).map((d) => d.abs)
}

async function readReport(dir: string) {
  return readJson(path.join(dir, 'report.json'))
}

/** gt.runs：磁盘上最近几次 run 的摘要（字段同 UE），旧的在前，和 UE 的顺序一致 */
async function runs(root: string) {
  const dirs = (await runDirs(await outputRoot(root))).slice(0, RECENT_RUNS)
  const items = (
    await Promise.all(
      dirs.map(async (dir) => {
        const r = await readReport(dir)
        if (!r || typeof r.runId !== 'string') return undefined
        const s: Record<string, unknown> = { outputDir: projectRel(root, dir) }
        for (const k of SUMMARY_KEYS) if (r[k] !== undefined) s[k] = r[k]
        if (s.total === undefined && Array.isArray(r.steps)) s.total = r.steps.length
        return s
      }),
    )
  ).filter((x): x is Record<string, unknown> => !!x)
  items.sort((a, b) => String(a.startedAtUtc ?? '').localeCompare(String(b.startedAtUtc ?? '')))
  return {
    runs: items,
    total: items.length,
    ...(items.length ? {} : { hint: t('产物目录里还没有运行报告') }),
  }
}

async function historyAll(root: string) {
  const all = await readJson(path.join(await outputRoot(root), 'history.json'))
  const s = all?.scenarios
  return (s && typeof s === 'object' && !Array.isArray(s) ? s : {}) as Record<string, unknown>
}

/** gt.history：给 scenario 回这个场景最近几次的明细；不给回每个场景的通过 / 失败串（p / f，最新在前） */
async function history(root: string, args: Record<string, unknown>) {
  const all = await historyAll(root)
  const scenario = slash(String(args.scenario ?? ''))
  if (scenario) return { keep: 10, scenario, runs: Array.isArray(all[scenario]) ? all[scenario] : [] }
  const scenarios: Record<string, string> = {}
  for (const [k, v] of Object.entries(all))
    if (Array.isArray(v))
      scenarios[k] = v.map((e) => ((e as { succeeded?: unknown })?.succeeded === true ? 'p' : 'f')).join('')
  return { keep: 10, scenarios }
}

/**
 * gt.report：按 runId 找产物目录里的 report.json。先查 history.json 里记的产物目录，没有再从最新的目录往前找。
 * 超过 12000 字和 UE 一样只回摘要和 file（页面再经 ext/gt/report 读整份）
 */
async function report(root: string, args: Record<string, unknown>) {
  const runId = String(args.runId ?? '')
  if (!runId) throw new Error(t('gt.report 需要 runId（gt.runs 列出最近的 run）'))
  let dir = ''
  for (const list of Object.values(await historyAll(root)))
    for (const e of Array.isArray(list) ? (list as { runId?: unknown; outputDir?: unknown }[]) : [])
      if (e?.runId === runId && typeof e.outputDir === 'string') dir = path.resolve(root, e.outputDir)
  let r = dir ? await readReport(dir) : undefined
  if (r?.runId !== runId) {
    r = undefined
    for (const d of await runDirs(await outputRoot(root))) {
      const x = await readReport(d)
      if (x?.runId === runId) {
        r = x
        dir = d
        break
      }
    }
  }
  if (!r) throw new Error(t('产物目录里找不到 runId「{id}」的报告（可能被清理了）', { id: runId }))
  const out = { ...r, outputDir: r.outputDir ?? projectRel(root, dir) }
  if (JSON.stringify(out).length <= STRUCTURE_MAX) return out
  const keep: Record<string, unknown> = {}
  for (const k of ['runId', 'name', 'scenario', 'succeeded', 'total', 'failed', 'outputDir'])
    if (k in out) keep[k] = out[k as keyof typeof out]
  return {
    ...keep,
    truncated: true,
    file: projectRel(root, path.join(dir, 'report.json')),
    hint: t('完整报告超过 {n} 字，在 file 里（相对项目根），需要细节时读这个文件', { n: STRUCTURE_MAX }),
  }
}

/** 编辑器没开时能从磁盘回答的 GameTest 操作 */
export const GT_DISK_OPS = new Set(['gt.scenarios', 'gt.runs', 'gt.history', 'gt.report'])

/**
 * 从磁盘回答 GameTest 的只读操作。返回里带 offline: true：Agent 看得出这是旧文件，
 * ue_gametest 也据此不把以前的报告当成这次的验证结论
 */
export async function gtFromDisk(root: string, op: string, args: Record<string, unknown>) {
  const res =
    op === 'gt.scenarios'
      ? await scenarios(root, args)
      : op === 'gt.runs'
        ? await runs(root)
        : op === 'gt.history'
          ? await history(root, args)
          : await report(root, args)
  return { ...res, offline: true }
}
