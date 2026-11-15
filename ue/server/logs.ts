import { createReadStream } from 'node:fs'
import { open, readdir, readFile, stat, truncate } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'
import type { UeProject } from './types.ts'

/**
 * UE 没在运行（或没装桥接）时的日志：直接读 Saved/Logs/<项目>.log（设计文档 3.1「编辑器没开时读」）；
 * 清空：没人占着文件时外面就能清（3.5）；崩溃记录读 Saved/Crashes。
 */
export interface LogLine {
  seq: number
  time?: string
  category: string
  verbosity: string
  text: string
}

const LINE = /^(?:\[([\d.:-]+)\]\[\s*\d+\])?(\w+):\s(?:(Fatal|Error|Warning|Display|Log|Verbose|VeryVerbose):\s)?(.*)$/

export function parseLine(raw: string, seq: number): LogLine {
  const m = LINE.exec(raw)
  if (!m) return { seq, category: '', verbosity: 'Log', text: raw }
  return { seq, time: m[1], category: m[2], verbosity: m[3] ?? 'Log', text: m[4] }
}

/**
 * 按顺序解析日志文件的行：UE 写多行消息（调用栈、脚本报错）时只有第一行带 [时间][帧] 前缀，后面的续行没有。
 * 续行沿用上一条的时间、分类和级别，不然一条 Error 的后半截会被当成 Log，按级别筛选时丢掉，全部里也显示成普通色。
 * 只在上一行带时间前缀时才算续行：文件开头还没开时间戳的那几行照常按「分类: 级别:」解析。
 */
export function lineParser() {
  let prev: LogLine | undefined
  return (raw: string, seq: number): LogLine & { cont?: boolean } => {
    if (prev?.time && !raw.startsWith('[')) {
      const { time, category, verbosity } = prev
      return { seq, time, category, verbosity, text: raw, cont: true }
    }
    prev = parseLine(raw, seq)
    return prev
  }
}

const isError = (v: string) => /^(error|fatal)$/i.test(v)
const isWarning = (v: string) => /^warning$/i.test(v)

/** 一段行里的错误、警告条数（续行不重复算，一条多行消息只算一次） */
export function countLevels(lines: (LogLine & { cont?: boolean })[]) {
  let errors = 0
  let warnings = 0
  for (const l of lines) {
    if (l.cont) continue
    if (isError(l.verbosity)) errors++
    else if (isWarning(l.verbosity)) warnings++
  }
  return { errors, warnings }
}

export const logFile = (p: UeProject) => path.join(p.root, 'Saved', 'Logs', `${p.uname}.log`)

/** 读文件尾部（最多 maxBytes），按行解析；seq 用行号，离线日志没有桥接的游标 */
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
    const parse = lineParser()
    // 整段（最多 maxBytes）都解析：续行要看前一行，计数也按读到的整段算，不只算最后 limit 行
    const parsed = all.filter((l) => l.length).map((l, i) => parse(l, i + 1))
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
  const parse = lineParser()
  let first = start > 0
  for await (const raw of rl) {
    // 从文件中间开始读时第一行是半行，丢掉
    if (first) {
      first = false
      continue
    }
    n++
    if (!raw) continue
    const l = parse(raw, n)
    if (!l.cont) {
      if (isError(l.verbosity)) errors++
      else if (isWarning(l.verbosity)) warnings++
    }
    if (!lineMatches(l, f)) continue
    matched++
    keep.push(l)
    if (keep.length > limit) keep.shift()
  }
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
