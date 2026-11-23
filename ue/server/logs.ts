import { createReadStream } from 'node:fs'
import { open, readdir, readFile, stat, truncate } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { entryReader, type LogLine } from './log-parse/entries.ts'
import type { UeProject } from './types.ts'
import { t } from './util.ts'

/**
 * UE 没在运行（或没装桥接）时的日志：直接读 Saved/Logs/<项目>.log（设计文档 3.1「编辑器没开时读」）；
 * 清空：没人占着文件时外面就能清（3.5）；崩溃记录读 Saved/Crashes。
 * 按「条」解析，多行消息的续行并进第一行（log-parse/entries.ts）。
 */
export type { LogLine } from './log-parse/entries.ts'
export { parseLine } from './log-parse/entries.ts'

const isError = (v: string) => /^(error|fatal)$/i.test(v)
const isWarning = (v: string) => /^warning$/i.test(v)

const reader = () => entryReader((n) => t('…（还有 {n} 行没列出，完整内容看日志文件）', { n }))

/** 一段记录里的错误、警告条数（多行消息是一条，只算一次） */
export function countLevels(lines: LogLine[]) {
  let errors = 0
  let warnings = 0
  for (const l of lines) {
    if (isError(l.verbosity)) errors++
    else if (isWarning(l.verbosity)) warnings++
  }
  return { errors, warnings }
}

export const logFile = (p: UeProject) => path.join(p.root, 'Saved', 'Logs', `${p.uname}.log`)

/** 读文件尾部（最多 maxBytes），按条解析，给最后 limit 条；seq 用这条第一行的行号，离线日志没有桥接的游标 */
export async function tailFile(file: string, limit = 500, maxBytes = 2 * 1024 * 1024) {
  const st = await stat(file).catch(() => null)
  if (!st) return { lines: [] as LogLine[], size: 0, file, errors: 0, warnings: 0 }
  const fh = await open(file, 'r')
  try {
    const start = Math.max(0, st.size - maxBytes)
    const buf = Buffer.alloc(st.size - start)
    await fh.read(buf, 0, buf.length, start)
    const all = buf.toString('utf8').split(/\r?\n/)
    if (start > 0) all.shift()
    // 整段（最多 maxBytes）都解析：续行要看前一行，计数也按读到的整段算，不只算最后 limit 条
    const r = reader()
    const parsed: LogLine[] = []
    all.forEach((raw, i) => {
      const l = raw && r.push(raw, i + 1)
      if (l) parsed.push(l)
    })
    const last = r.end()
    if (last) parsed.push(last)
    return { lines: parsed.slice(-limit), size: st.size, file, ...countLevels(parsed) }
  } finally {
    await fh.close()
  }
}

export interface LineFilter {
  category?: string
  verbosity?: string
  /**
   * true：只要这一级（Warning 只要警告，Error 要错误和致命错误），网页的级别分段用；
   * 不填：verbosity 是最低级别（Warning 连错误也要），给 Agent 的 ue_log 用
   */
  exact?: boolean
  contains?: string
}

const RANK = ['fatal', 'error', 'warning', 'display', 'log', 'verbose', 'veryverbose']

/** 级别筛选：exact 时 Error 和 Fatal 算同一级（都是「错误」），其余按名字相等 */
export function levelMatches(verbosity: string, want: string | undefined, exact?: boolean) {
  const w = (want ?? '').toLowerCase()
  if (!w) return true
  const v = verbosity.toLowerCase()
  if (exact) return isError(w) ? isError(v) : v === w
  return RANK.indexOf(v) <= RANK.indexOf(w)
}

export function lineMatches(l: LogLine, f: LineFilter) {
  return (
    (!f.category || l.category.toLowerCase().startsWith(f.category.toLowerCase())) &&
    levelMatches(l.verbosity, f.verbosity, f.exact) &&
    (!f.contains || l.text.toLowerCase().includes(f.contains.toLowerCase()))
  )
}

/**
 * 带筛选地搜日志文件（性能：日志可能有几个 GB）：按行流式读，不整个读进内存；只扫文件最后 maxBytes（默认 64 MB），
 * 只留最后 limit 条匹配（环形），结果里说明扫了多少、有没有更早的没扫到
 */
export async function searchFile(file: string, f: LineFilter, limit = 500, maxBytes = 64 * 1024 * 1024) {
  const st = await stat(file).catch(() => null)
  if (!st)
    return { lines: [] as LogLine[], size: 0, file, scanned: 0, truncated: false, matched: 0, errors: 0, warnings: 0 }
  const start = Math.max(0, st.size - maxBytes)
  const rl = createInterface({ input: createReadStream(file, { start, encoding: 'utf8' }), crlfDelay: Infinity })
  const keep: LogLine[] = []
  let n = 0
  let matched = 0
  // 计数按扫过的所有行算，和当前筛选无关：选「警告」时「错误 N」不会变成 0
  let errors = 0
  let warnings = 0
  const r = reader()
  let first = start > 0
  // 一条凑齐（看到下一条的开头或读完）才计数、筛选：多行消息按整条搜文字，级别和分类按第一行
  const take = (l: LogLine | undefined) => {
    if (!l) return
    if (isError(l.verbosity)) errors++
    else if (isWarning(l.verbosity)) warnings++
    if (!lineMatches(l, f)) return
    matched++
    keep.push(l)
    if (keep.length > limit) keep.shift()
  }
  for await (const raw of rl) {
    // 从文件中间开始读时第一行是半行，丢掉
    if (first) {
      first = false
      continue
    }
    n++
    if (raw) take(r.push(raw, n))
  }
  take(r.end())
  return { lines: keep, size: st.size, file, scanned: st.size - start, truncated: start > 0, matched, errors, warnings }
}

export async function logSize(p: UeProject) {
  return (await stat(logFile(p)).catch(() => null))?.size ?? 0
}

export async function clearOfflineLog(p: UeProject) {
  await truncate(logFile(p), 0)
}

export interface Crash {
  id: string
  at: string
  error: string
  dir: string
  log: string
}

/** Saved/Crashes/<目录>：CrashContext.runtime-xml 里的 ErrorMessage 和目录里的 .log */
export async function crashes(p: UeProject, limit = 30): Promise<Crash[]> {
  const base = path.join(p.root, 'Saved', 'Crashes')
  const out: Crash[] = []
  for (const name of await readdir(base).catch(() => [] as string[])) {
    const dir = path.join(base, name)
    const st = await stat(dir).catch(() => null)
    if (!st?.isDirectory()) continue
    const files = await readdir(dir).catch(() => [] as string[])
    const xml = await readFile(path.join(dir, 'CrashContext.runtime-xml'), 'utf8').catch(() => '')
    const msg = /<ErrorMessage>([\s\S]*?)<\/ErrorMessage>/.exec(xml)?.[1] ?? ''
    const log = files.find((f) => f.endsWith('.log'))
    out.push({
      id: name,
      at: st.mtime.toISOString(),
      error: msg.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim().slice(0, 600),
      dir,
      log: log ? path.join(dir, log) : '',
    })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}
