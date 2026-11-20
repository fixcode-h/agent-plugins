import { copyFile, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { serialize, toV4WithTodos } from '../../../shared/gt-script/script.ts'
import { migrateSettings } from '../../../shared/gt-script/ref/migrate/settings.ts'
import type { MigrateTodo } from '../../../shared/gt-script/ref/migrate/context.ts'
import type { GtScript } from '../../../shared/gt-script/types.ts'
import { scenarioRoot } from '../gt-disk.ts'
import { scenarioFile } from '../gt-paths.ts'
import { t } from '../../util.ts'

/**
 * 面板侧操作 gt.migrate（协议 game-test-ref 第 9 节）：把场景根里 v1–v3 的场景和 _settings.json 迁到 v4。
 * 迁移只在面板做（UE 2.0 不再读 v3），所以不经过 UE：编辑器没开也能升级。写回前原文件存一份 .v3.bak，
 * 迁不准的地方写进 todo（校验报 migrate_todo 警告），返回里逐个文件列出，网页和 ue_gametest action=migrate 共用。
 */
export interface GtMigrateArgs {
  /** 相对场景根的一个文件（场景或 _settings.json） */
  scenario?: string
  /** 场景根下全部 */
  all?: boolean
  /** 只算不写 */
  dryRun?: boolean
}

export interface GtMigrateResult {
  changed: { path: string; todos: MigrateTodo[]; backup?: string }[]
  skipped: { path: string; reason: string }[]
  errors: { path: string; message: string }[]
  dryRun?: boolean
}

const SETTINGS = '_settings.json'
const slash = (p: string) => p.replace(/\\/g, '/')
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** 场景根下要看的文件：全部场景（_ 开头的是配置和生成物，不是场景）+ 根上的 _settings.json */
async function listFiles(rootAbs: string) {
  const out: string[] = []
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) await walk(abs)
      else if (e.isFile() && /\.json$/i.test(e.name) && !e.name.startsWith('_')) out.push(abs)
    }
  }
  await walk(rootAbs)
  out.sort()
  out.unshift(path.join(rootAbs, SETTINGS))
  return out
}

/** 原文件的缩进：GameTest 写的是 tab，手写的多是两个空格；写回时跟着原文件，diff 只剩真改的行 */
const indentOf = (text: string) => (/\n\t/.test(text) ? '\t' : (/\n( +)\S/.exec(text)?.[1] ?? '\t'))

/** 备份名：a.json.v3.bak，已有就 a.json.v3.1.bak、a.json.v3.2.bak…（不以 .json 结尾，场景列表不会把它当场景） */
async function backup(abs: string) {
  for (let i = 0; i < 1000; i++) {
    const to = `${abs}.v3${i ? `.${i}` : ''}.bak`
    try {
      await copyFile(abs, to, constants.COPYFILE_EXCL)
      return to
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
  throw new Error(t('备份文件太多了：先清理 {p} 旁边的 .bak', { p: path.basename(abs) }))
}

/** 先写临时文件再改名：写到一半出错不会留下半份场景 */
async function writeAtomic(abs: string, text: string) {
  const tmp = `${abs}.migrate-tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, abs)
}

type Plan = { kind: 'skip'; reason: string } | { kind: 'write'; text: string; todos: MigrateTodo[] }

/** 一个文件迁成什么样（不写盘） */
function plan(rel: string, text: string): Plan {
  let doc: unknown
  try {
    doc = JSON.parse(text.replace(/^﻿/, ''))
  } catch (e) {
    throw new Error(t('不是合法的 JSON：{m}', { m: (e as Error).message }))
  }
  if (!isObj(doc)) throw new Error(t('不是 JSON 对象'))
  const indent = indentOf(text)
  if (path.basename(rel) === SETTINGS) {
    const m = migrateSettings(doc)
    if (!m.changed) return { kind: 'skip', reason: t('运行配置里没有旧写法') }
    return { kind: 'write', text: JSON.stringify(m.doc, null, indent) + '\n', todos: m.todos }
  }
  if (typeof doc.kind === 'string' && doc.kind.toLowerCase() !== 'gametest-scenario')
    return { kind: 'skip', reason: t('不是场景（kind 是 {k}）', { k: doc.kind }) }
  if (!Array.isArray(doc.steps)) return { kind: 'skip', reason: t('不是场景（没有 steps）') }
  const v = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1
  if (v >= 4) return { kind: 'skip', reason: t('已经是 v{v}', { v }) }
  const m = toV4WithTodos(doc as GtScript)
  const out = indent === '\t' ? serialize(m.doc) : JSON.stringify(m.doc, null, indent) + '\n'
  return { kind: 'write', text: out, todos: m.todos }
}

export async function gtMigrate(projectRoot: string, a: GtMigrateArgs): Promise<GtMigrateResult> {
  const rootAbs = await scenarioRoot(projectRoot)
  let files: string[]
  if (typeof a.scenario === 'string' && a.scenario.trim()) files = [scenarioFile(projectRoot, rootAbs, a.scenario).abs]
  else if (a.all === true) files = await listFiles(rootAbs)
  else throw new Error(t('gt.migrate 要写 scenario（相对场景根的文件）或 all: true'))
  const res: GtMigrateResult = { changed: [], skipped: [], errors: [], ...(a.dryRun ? { dryRun: true } : {}) }
  for (const abs of files) {
    const rel = slash(path.relative(rootAbs, abs))
    const text = await readFile(abs, 'utf8').catch(() => undefined)
    if (text === undefined) {
      // 全量时 _settings.json 没有是常态；点名要迁的文件不在才算错
      if (a.all) {
        if (rel !== SETTINGS) res.errors.push({ path: rel, message: t('读不了这个文件') })
      } else res.errors.push({ path: rel, message: t('文件不存在') })
      continue
    }
    try {
      const p = plan(rel, text)
      if (p.kind === 'skip') {
        res.skipped.push({ path: rel, reason: p.reason })
        continue
      }
      if (a.dryRun) {
        res.changed.push({ path: rel, todos: p.todos })
        continue
      }
      const bak = await backup(abs)
      await writeAtomic(abs, p.text)
      res.changed.push({ path: rel, todos: p.todos, backup: slash(path.relative(rootAbs, bak)) })
    } catch (e) {
      res.errors.push({ path: rel, message: (e as Error).message })
    }
  }
  return res
}

/** 给 Agent 的短版（ADR 0067：默认不超过 4000 字）：todo 只留前几条，总数照报 */
export function compactMigrate(r: GtMigrateResult, max = 4000) {
  let keep = 5
  const shape = () => ({
    ...(r.dryRun ? { dryRun: true } : {}),
    changed: r.changed.map((x) => ({
      path: x.path,
      todos: x.todos.length,
      ...(x.todos.length ? { first: x.todos.slice(0, keep).map((y) => `${y.at}: ${y.message}`) } : {}),
    })),
    skipped: r.skipped.length,
    errors: r.errors,
  })
  let out = shape()
  while (JSON.stringify(out).length > max && keep > 0) {
    keep--
    out = shape()
  }
  if (JSON.stringify(out).length > max)
    return {
      ...(r.dryRun ? { dryRun: true } : {}),
      changed: r.changed.length,
      todos: r.changed.reduce((n, x) => n + x.todos.length, 0),
      skipped: r.skipped.length,
      errors: r.errors.length,
      hint: '文件太多，只列了个数：用 scenario 一次迁一个能看到每条 todo',
    }
  return out
}
