import { createHash } from 'node:crypto'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { BridgeError } from './instances.ts'
import { csvCompare, csvQuery, csvSummary, parseCsv, type CsvCapture, type CsvQuery } from './perf/csv.ts'
import { memCompare, memQuery, memSummary, parseMemReport, type MemQuery, type MemReport } from './perf/memreport.ts'
import type { Actor, UeProject } from './types.ts'
import { c, readJson, t, writeJson } from './util.ts'

/**
 * 抓取登记：性能和内存抓取的文件清单，以及对它们的摘要、查询、对比（设计稿「性能与内存分析」）。
 * 文件留在项目的 Saved/Profiling 下，这里只记面板知道的附加信息（谁发起的、起的名字、书签、导入的外部文件）。
 * 手动在 UE 里抓的文件也会被扫出来，所以 id 用路径算，不靠登记。
 */
export type CaptureKind = 'csv' | 'memreport' | 'trace'

export interface CaptureMeta {
  label?: string
  /** 谁发起的；手动抓的没有 */
  by?: Actor
  startedAt?: string
  /** 面板这边记的书签：相对抓取开始的秒数。CSV 里的事件靠引擎写，这里是引擎没写进去时的后备 */
  marks?: { at: number; name: string }[]
  pid?: number
  /** trace 的录制预设 */
  preset?: string
}

export interface Capture extends CaptureMeta {
  id: string
  kind: CaptureKind
  file: string
  size: number
  /** 文件修改时间 */
  at: string
  /** 导入的外部文件（不在项目的 Saved/Profiling 下） */
  imported?: boolean
}

interface Store {
  meta: Record<string, CaptureMeta>
  /** 导入的外部文件的绝对路径 */
  imported: string[]
}

const storeFile = (project: string) => path.join(c().dataDir, 'captures', `${encodeURIComponent(project)}.json`)
const readStore = async (project: string): Promise<Store> => ({
  meta: {},
  imported: [],
  ...(await readJson<Partial<Store>>(storeFile(project), {})),
})

export const profilingDir = (p: UeProject) => path.join(p.root, 'Saved', 'Profiling')

export function kindOfFile(file: string): CaptureKind | undefined {
  const n = file.toLowerCase()
  if (n.endsWith('.csv') || n.endsWith('.csv.gz')) return 'csv'
  if (n.endsWith('.memreport')) return 'memreport'
  if (n.endsWith('.utrace')) return 'trace'
  return undefined
}

/** id 按文件的绝对路径算：同一个文件每次扫出来 id 都一样，不依赖登记文件 */
export const captureId = (file: string) =>
  createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 8)

async function walk(dir: string, depth: number, out: string[]) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (depth > 0) await walk(f, depth - 1, out)
    } else if (kindOfFile(e.name)) out.push(f)
  }
}

export async function listCaptures(p: UeProject): Promise<Capture[]> {
  const store = await readStore(p.id)
  const files: string[] = []
  // CSV 在 Profiling/CSV，memreport 在 Profiling/MemReports/<日期目录>，trace 在 Profiling 或 TraceSessions
  await walk(profilingDir(p), 3, files)
  await walk(path.join(p.root, 'Saved', 'TraceSessions'), 1, files)
  const out: Capture[] = []
  for (const [file, imported] of [
    ...files.map((f) => [f, false] as const),
    ...store.imported.map((f) => [f, true] as const),
  ]) {
    const st = await stat(file).catch(() => undefined)
    const kind = kindOfFile(file)
    if (!st?.isFile() || !kind) continue
    const id = captureId(file)
    if (out.some((x) => x.id === id)) continue
    out.push({
      id,
      kind,
      file,
      size: st.size,
      at: st.mtime.toISOString(),
      ...(imported ? { imported } : {}),
      ...store.meta[id],
    })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

export async function getCapture(p: UeProject, id: string): Promise<Capture> {
  const all = await listCaptures(p)
  const key = id.trim().toLowerCase()
  // 也认名字和文件名，Agent 和用户都更容易记
  const hit =
    all.find((x) => x.id === key) ??
    all.find((x) => x.label?.toLowerCase() === key) ??
    all.find((x) => path.basename(x.file).toLowerCase() === key)
  if (!hit) throw new BridgeError(t('没有这份抓取：{id}（用 ue_capture action=list 看有哪些）', { id }))
  return hit
}

export async function setMeta(project: string, id: string, patch: CaptureMeta) {
  const store = await readStore(project)
  store.meta[id] = { ...store.meta[id], ...patch }
  await writeJson(storeFile(project), store)
}

/** 导入：只登记路径，不复制、不改原文件 */
export async function importCapture(p: UeProject, file: string, label?: string) {
  const abs = path.resolve(file)
  const st = await stat(abs).catch(() => undefined)
  if (!st?.isFile()) throw new BridgeError(t('文件不存在：{file}', { file: abs }))
  if (!kindOfFile(abs)) throw new BridgeError(t('只认 .csv、.csv.gz、.memreport、.utrace 文件'))
  const store = await readStore(p.id)
  const inProject = !path.relative(profilingDir(p), abs).startsWith('..')
  if (!inProject && !store.imported.includes(abs)) store.imported.push(abs)
  const id = captureId(abs)
  if (label) store.meta[id] = { ...store.meta[id], label }
  await writeJson(storeFile(p.id), store)
  return getCapture(p, id)
}

/** 删除：项目里的抓取删文件；导入的外部文件只取消登记，不动别人的文件 */
export async function deleteCapture(p: UeProject, id: string) {
  const cap = await getCapture(p, id)
  const store = await readStore(p.id)
  if (cap.imported) store.imported = store.imported.filter((f) => captureId(f) !== cap.id)
  else await rm(cap.file, { force: true })
  delete store.meta[cap.id]
  await writeJson(storeFile(p.id), store)
  cache.delete(cap.file)
  return { deleted: cap.file, fileRemoved: !cap.imported }
}

/** 整个读进内存解析，太大的不读：CSV 每帧一行，几百 MB 的是几个小时的录制，应该先在 UE 里按段重抓 */
const MAX_BYTES = 300 * 1024 * 1024

type Parsed = { kind: 'csv'; data: CsvCapture } | { kind: 'memreport'; data: MemReport }
/** 解析结果留最近 3 份：Agent 会对同一份抓取连着查好几次，每次重读重算太慢 */
const cache = new Map<string, { key: string; parsed: Parsed }>()

async function load(cap: Capture): Promise<Parsed> {
  if (cap.kind === 'trace')
    throw new BridgeError(
      t(
        '这是 Unreal Insights 的 trace（.utrace），这个版本还不能分析，只能登记和在 Insights 里打开；先用 CSV 和 memreport',
      ),
    )
  const key = `${cap.size}:${cap.at}`
  const hit = cache.get(cap.file)
  if (hit?.key === key) return hit.parsed
  if (cap.size > MAX_BYTES)
    throw new BridgeError(
      t('文件有 {mb} MB，太大了（上限 300 MB）：缩短录制时间重新抓一份', { mb: Math.round(cap.size / 1048576) }),
    )
  const buf = await readFile(cap.file)
  const text = cap.file.toLowerCase().endsWith('.gz') ? gunzipSync(buf).toString('utf8') : decode(buf)
  let parsed: Parsed
  try {
    parsed =
      cap.kind === 'csv' ? { kind: 'csv', data: parseCsv(text) } : { kind: 'memreport', data: parseMemReport(text) }
  } catch (e) {
    throw new BridgeError(`${path.basename(cap.file)}：${(e as Error).message}`)
  }
  cache.set(cap.file, { key, parsed })
  if (cache.size > 3) cache.delete(cache.keys().next().value as string)
  return parsed
}

/** UE 在 Windows 上写的文本文件可能是 UTF-16（带 BOM），按 BOM 认 */
function decode(buf: Buffer) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le')
  return buf.toString('utf8')
}

const brief = (cap: Capture) => ({
  id: cap.id,
  kind: cap.kind,
  label: cap.label,
  file: cap.file,
  sizeKB: Math.round(cap.size / 1024),
  at: cap.at,
  by: cap.by ? (cap.by.kind === 'user' ? 'user' : (cap.by.agent ?? 'agent')) : undefined,
  marks: cap.marks?.length ? cap.marks : undefined,
  imported: cap.imported,
  preset: cap.preset,
})

export async function captureList(p: UeProject, kind?: string, limit = 30) {
  const all = await listCaptures(p)
  const items = all.filter((x) => !kind || x.kind === kind)
  return {
    total: items.length,
    totalKB: Math.round(all.reduce((s, x) => s + x.size, 0) / 1024),
    items: items.slice(0, limit).map(brief),
  }
}

export async function captureSummary(p: UeProject, id: string) {
  const cap = await getCapture(p, id)
  const parsed = await load(cap)
  return {
    capture: brief(cap),
    summary: parsed.kind === 'csv' ? csvSummary(parsed.data) : memSummary(parsed.data),
  }
}

/** from / to 可以写秒数，也可以写书签的名字（CSV 里的事件或面板记的书签） */
function resolveTime(cap: Capture, data: CsvCapture, v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  if (Number.isFinite(n)) return n
  const name = String(v).toLowerCase()
  const ev =
    data.events.find((e) => e.name.toLowerCase() === name) ??
    data.events.find((e) => e.name.toLowerCase().includes(name))
  if (ev) return ev.time
  const mark = cap.marks?.find((m) => m.name.toLowerCase() === name)
  if (mark) return mark.at
  throw new BridgeError(t('from / to 要写秒数或书签的名字，这份抓取里没有叫「{name}」的书签', { name: String(v) }))
}

export async function captureQuery(p: UeProject, id: string, q: Record<string, unknown>) {
  const cap = await getCapture(p, id)
  const parsed = await load(cap)
  const what = String(q.what ?? '')
  try {
    if (parsed.kind === 'csv') {
      const cq: CsvQuery = {
        what,
        name: q.name === undefined ? undefined : String(q.name),
        frame: q.frame === undefined ? undefined : Number(q.frame),
        from: resolveTime(cap, parsed.data, q.from),
        to: resolveTime(cap, parsed.data, q.to),
        top: q.top === undefined ? undefined : Number(q.top),
        thresholdMs: q.thresholdMs === undefined ? undefined : Number(q.thresholdMs),
        offset: q.offset === undefined ? undefined : Number(q.offset),
      }
      return csvQuery(parsed.data, cq)
    }
    const mq: MemQuery = {
      what,
      name: q.name === undefined ? undefined : String(q.name),
      sort: q.sort === undefined ? undefined : String(q.sort),
      top: q.top === undefined ? undefined : Number(q.top),
      offset: q.offset === undefined ? undefined : Number(q.offset),
      contains: q.contains === undefined ? undefined : String(q.contains),
    }
    return memQuery(parsed.data, mq)
  } catch (e) {
    throw e instanceof BridgeError ? e : new BridgeError((e as Error).message)
  }
}

export async function captureCompare(p: UeProject, a: string, b: string, top?: number) {
  const [ca, cb] = [await getCapture(p, a), await getCapture(p, b)]
  if (ca.kind !== cb.kind)
    throw new BridgeError(
      t('两份抓取要是同一种才能对比：{a} 是 {ka}，{b} 是 {kb}', { a: ca.id, ka: ca.kind, b: cb.id, kb: cb.kind }),
    )
  const [pa, pb] = [await load(ca), await load(cb)]
  try {
    const diff =
      pa.kind === 'csv' && pb.kind === 'csv'
        ? csvCompare(pa.data, pb.data, top)
        : pa.kind === 'memreport' && pb.kind === 'memreport'
          ? memCompare(pa.data, pb.data, top)
          : undefined
    return { a: brief(ca), b: brief(cb), diff }
  } catch (e) {
    throw new BridgeError((e as Error).message)
  }
}
