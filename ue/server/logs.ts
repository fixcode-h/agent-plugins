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

export const logFile = (p: UeProject) => path.join(p.root, 'Saved', 'Logs', `${p.uname}.log`)

/** 读文件尾部（最多 maxBytes），按行解析；seq 用行号，离线日志没有桥接的游标 */
export async function tailFile(file: string, limit = 500, maxBytes = 2 * 1024 * 1024) {
  const st = await stat(file).catch(() => null)
  if (!st) return { lines: [] as LogLine[], size: 0, file }
  const fh = await open(file, 'r')
  try {
    const start = Math.max(0, st.size - maxBytes)
    const buf = Buffer.alloc(st.size - start)
    await fh.read(buf, 0, buf.length, start)
    const all = buf.toString('utf8').split(/\r?\n/)
    if (start > 0) all.shift()
    const raw = all.filter((l) => l.length).slice(-limit)
    return { lines: raw.map((l, i) => parseLine(l, i + 1)), size: st.size, file }
  } finally {
    await fh.close()
  }
}

export interface LineFilter {
  category?: string
  verbosity?: string
  contains?: string
}

const RANK = ['fatal', 'error', 'warning', 'display', 'log', 'verbose', 'veryverbose']

export function lineMatches(l: LogLine, f: LineFilter) {
  const want = (f.verbosity ?? '').toLowerCase()
  return (
    (!f.category || l.category.toLowerCase().startsWith(f.category.toLowerCase())) &&
    (!want || RANK.indexOf(l.verbosity.toLowerCase()) <= RANK.indexOf(want)) &&
    (!f.contains || l.text.toLowerCase().includes(f.contains.toLowerCase()))
  )
}

/**
 * 带筛选地搜日志文件（性能：日志可能有几个 GB）：按行流式读，不整个读进内存；只扫文件最后 maxBytes（默认 64 MB），
 * 只留最后 limit 条匹配（环形），结果里说明扫了多少、有没有更早的没扫到
 */
export async function searchFile(file: string, f: LineFilter, limit = 500, maxBytes = 64 * 1024 * 1024) {
  const st = await stat(file).catch(() => null)
  if (!st) return { lines: [] as LogLine[], size: 0, file, scanned: 0, truncated: false, matched: 0 }
  const start = Math.max(0, st.size - maxBytes)
  const rl = createInterface({ input: createReadStream(file, { start, encoding: 'utf8' }), crlfDelay: Infinity })
  const keep: LogLine[] = []
  let n = 0
  let matched = 0
  let first = start > 0
  for await (const raw of rl) {
    // 从文件中间开始读时第一行是半行，丢掉
    if (first) {
      first = false
      continue
    }
    n++
    if (!raw) continue
    const l = parseLine(raw, n)
    if (!lineMatches(l, f)) continue
    matched++
    keep.push(l)
    if (keep.length > limit) keep.shift()
  }
  return { lines: keep, size: st.size, file, scanned: st.size - start, truncated: start > 0, matched }
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
