/**
 * 表格页的文件层：按项目设置的表格目录列出表格文件、解析（带缓存）。跨文件按内容搜索在 search.ts。
 * 只读：写回在 server/tables/write.ts。解析结果按「修改时间 + 大小」缓存，跨表搜索第一次全量解析、之后只重读变过的文件。
 */
import path from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import { t } from '../../shared/i18n.ts'
import { csvFormat, parseCsv } from '../../shared/csv.ts'
import {
  TABLE_EXCLUDE,
  globHit,
  globList,
  tableKind,
  type TableDoc,
  type TableFile,
  type TableRoot,
  type TablesConfig,
  type TablesIndex,
} from '../../shared/tables.ts'
import type { SheetData } from '../../shared/files.ts'
import { byTablePath, type TablesListProgress } from '../../shared/table-list.ts'
import { MAX_XLSX_BYTES, readXlsx, type XlsxLimits } from '../xlsx.ts'
import { resolvePath } from '../fs.ts'

/**
 * 表格页按这个上限读 xlsx：单张表 200 万格、整本 400 万格（1 万行 × 80 列的大表也能整份读进来改）。
 * 文件弹窗还用面板默认的低上限：它只是看一眼，不值得往页面上发几十兆
 */
export const TABLE_XLSX: XlsxLimits = { sheetCells: 2_000_000, bookCells: 4_000_000 }

/** 读一份 xlsx 给表格页（解析、保存前后的比对都用同一个上限，不然大表保存时读回来对不上） */
export const readTableXlsx = (buf: Buffer) => readXlsx(buf, TABLE_XLSX)

/**
 * 一个项目最多列这么多个表格文件：只防把表格目录设成整个盘之类的误设，正常项目（几万张表）都能完整列出来；
 * 列表有索引（list-index.ts），打开时不用重走目录
 */
const MAX_FILES = 200_000
/** 解析缓存最多留这么多个单元格（所有文件合计）；超了丢掉最久没用的 */
const CACHE_CELLS = 6_000_000
/** 不往里走的目录 */
const SKIP_DIRS = new Set(['.git', '.svn', '.p4', 'node_modules', '.agentpanel']) // 模块状态：常量，加载后不改

const norm = (p: string) => p.replace(/\\/g, '/')

/** 绝对路径（含 Windows 盘符、~ 开头）：表格目录可以在项目目录之外，比如策划仓库和客户端分开放 */
export const absPath = (p: string) => path.isAbsolute(p) || /^[a-zA-Z]:[\\/]/.test(p) || /^~([\\/]|$)/.test(p)

/** 表格路径对应的磁盘路径：相对项目目录的拼上项目目录，绝对路径原样 */
export const tableFull = (dir: string, p: string) => path.resolve(dir, p)

/** child 在不在 parent 里（Windows 不分大小写） */
function inside(parent: string, child: string) {
  const r = path.relative(parent, child)
  return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r))
}

/**
 * 设置里的一个表格目录：相对项目目录的直接用；绝对路径落在项目目录里的也换成相对路径（和以前一样），
 * 在项目目录外的用正斜杠的绝对路径当文件路径的前缀
 */
export function tableRoot(dir: string, d: string): { key: string; full: string } {
  if (absPath(d)) {
    const full = resolvePath(d)
    return inside(dir, full) ? { key: norm(path.relative(dir, full)), full } : { key: norm(full), full }
  }
  const rel = /^\.[\\/]*$/.test(d.trim()) ? '' : safeRel(dir, d).rel.replace(/\/+$/, '')
  return { key: rel, full: path.join(dir, rel) }
}

/**
 * 表格页传来的文件路径不能跑出项目目录和设置的表格目录：
 * 相对路径不能有 ..；绝对路径必须落在某个设置在项目目录外的表格目录里
 */
export function safeRel(dir: string, rel: string, cfg?: Pick<TablesConfig, 'dirs'>) {
  const n = norm(rel).replace(/^\.\/+/, '')
  if (n && absPath(n) && cfg) {
    const full = path.resolve(n)
    const ok = cfg.dirs.some((d) => {
      if (!absPath(d)) return false
      const root = resolvePath(d)
      return !inside(dir, root) && inside(root, full)
    })
    if (ok) return { rel: norm(full), full }
  }
  if (!n || absPath(n) || n.split('/').includes('..')) throw new Error(t('只能查看项目目录和表格目录里的文件'))
  return { rel: n, full: path.join(dir, n) }
}

/** 同时读几个目录：一个个等，几千个目录在 Windows（杀毒、网络盘）上要十几秒 */
const DIR_JOBS = 16

/** 扫描进行到哪了（推给页面时再带上列表的键和等着的项目） */
export type WalkProgress = Omit<TablesListProgress, 'key' | 'projects'>

/** 走一遍表格目录列出全部表格文件（按路径排序）。只读目录、不逐个 stat（几万张表在 Windows 上 stat 要好几秒，列表也用不上大小和修改时间）。平时经 list-index.ts 的 listTables 取（有索引和缓存），不直接调 */
export async function walkTables(
  dir: string,
  cfg: TablesConfig,
  onProgress?: (p: WalkProgress) => void,
): Promise<TablesIndex> {
  const include = globList(cfg.include)
  const exclude = globList(cfg.exclude || TABLE_EXCLUDE)
  const files: TableFile[] = []
  const dirs: string[] = []
  const missing: string[] = []
  const roots: TableRoot[] = []
  let truncated = false
  let seenDirs = 0
  const seen = new Set<string>()
  /** 一个目录：读出里面的表格，子目录交回去排队 */
  async function readOne(rel: string): Promise<string[]> {
    const entries = await readdir(tableFull(dir, rel), { withFileTypes: true }).catch(() => [])
    seenDirs++
    onProgress?.({ found: files.length, dirs: seenDirs, at: rel })
    const sub: string[] = []
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !globHit(child, exclude)) sub.push(child)
        continue
      }
      if (!e.isFile() || seen.has(child)) continue
      const kind = tableKind(e.name)
      if (!kind || !globHit(child, include) || globHit(child, exclude)) continue
      if (files.length >= MAX_FILES) {
        truncated = true
        return []
      }
      seen.add(child)
      files.push({ path: child, kind })
    }
    return sub
  }
  /** 整棵目录树：最多 DIR_JOBS 个目录同时读 */
  async function walk(top: string) {
    const queue = [top]
    let running = 0
    await new Promise<void>((done) => {
      const next = () => {
        if (!queue.length && !running) return done()
        while (running < DIR_JOBS && queue.length && !truncated) {
          const rel = queue.pop()!
          running++
          void readOne(rel).then((sub) => {
            running--
            queue.push(...sub)
            next()
          })
        }
        if (truncated && !running) done()
      }
      next()
    })
  }
  for (const d of cfg.dirs) {
    let root: { key: string; full: string }
    try {
      root = tableRoot(dir, d)
    } catch {
      missing.push(d)
      roots.push({ dir: d, full: '', found: false, files: 0 })
      continue
    }
    const ok = await stat(root.full)
      .then((s) => s.isDirectory())
      .catch(() => false)
    if (!ok) {
      missing.push(d)
      roots.push({ dir: d, full: root.full, found: false, files: 0 })
      continue
    }
    const before = files.length
    dirs.push(root.key)
    await walk(root.key)
    roots.push({ dir: d, full: root.full, found: true, files: files.length - before })
  }
  files.sort(byTablePath)
  return { dirs, missing, roots, files, ...(truncated ? { truncated } : {}) }
}

interface Cached {
  key: string
  sheets: SheetData[]
  cells: number
  csv?: TableDoc['csv']
}
const cache = new Map<string, Cached>() // 模块状态：缓存，丢了重算
let cachedCells = 0

const countCells = (sheets: SheetData[]) => sheets.reduce((n, s) => n + s.rows.reduce((m, r) => m + r.length, 0), 0)

function remember(full: string, c: Cached) {
  const old = cache.get(full)
  if (old) cachedCells -= old.cells
  cache.delete(full)
  cache.set(full, c)
  cachedCells += c.cells
  // Map 按插入顺序：最前面的是最久没用的
  for (const [k, v] of cache) {
    if (cachedCells <= CACHE_CELLS || k === full) break
    cache.delete(k)
    cachedCells -= v.cells
  }
}

/** 文件改过（保存、外部改动）后让缓存失效 */
export const forgetTable = (full: string) => {
  const old = cache.get(full)
  if (old) cachedCells -= old.cells
  cache.delete(full)
}

/** 刚写进去的文件：已经有解析结果了，按新的修改时间和大小放进缓存（只给 xlsx 用，CSV 还要记分隔符这些） */
export async function primeTable(full: string, sheets: SheetData[]) {
  const info = await stat(full).catch(() => null)
  if (!info) return forgetTable(full)
  remember(full, { key: `${info.mtimeMs}:${info.size}`, sheets, cells: countCells(sheets) })
}

/** 解析一个表格文件（xlsx / csv），带缓存 */
export async function parseTable(full: string): Promise<{ sheets: SheetData[]; csv?: TableDoc['csv'] }> {
  const info = await stat(full)
  const key = `${info.mtimeMs}:${info.size}`
  const hit = cache.get(full)
  if (hit && hit.key === key) {
    // 用了一次：挪到最后（最近用过）
    cache.delete(full)
    cache.set(full, hit)
    return hit
  }
  if (tableKind(full) === 'xlsx' && info.size > MAX_XLSX_BYTES)
    throw new Error(t('表格太大（超过 30 MB），请用表格软件打开'))
  const { sheets, csv } = await parseTableBuffer(full, await readFile(full))
  const c: Cached = { key, sheets, cells: countCells(sheets), csv }
  remember(full, c)
  return c
}

/** 按文件名认格式解析一份内容（磁盘上的文件、版本控制里取出的旧版本都用它），不缓存 */
export async function parseTableBuffer(
  name: string,
  buf: Buffer,
): Promise<{ sheets: SheetData[]; csv?: TableDoc['csv'] }> {
  const kind = tableKind(name)
  if (kind === 'xlsx') {
    if (buf.length > MAX_XLSX_BYTES) throw new Error(t('表格太大（超过 30 MB），请用表格软件打开'))
    return { sheets: readTableXlsx(buf) }
  }
  if (kind === 'csv') {
    const text = buf.toString('utf8')
    const csv = csvFormat(text, /\.tsv$/i.test(name))
    return { csv, sheets: [{ name: path.basename(name).replace(/\.[^.]+$/, ''), rows: parseCsv(text, csv.delimiter) }] }
  }
  throw new Error(t('老的 .xls / .et 格式只能用表格软件打开，另存为 .xlsx 后能在这里看和改'))
}

/** 同目录有 Office / WPS 的锁文件（~$ 开头）：文件正被打开 */
export async function lockedByOffice(full: string) {
  const base = path.basename(full)
  const dir = path.dirname(full)
  // Excel 用「~$」+ 原名（长名字会去掉前两个字），WPS 用「.~」+ 原名
  const names = [`~$${base}`, `~$${base.slice(2)}`, `.~${base}`]
  for (const n of names)
    if (
      await stat(path.join(dir, n))
        .then(() => true)
        .catch(() => false)
    )
      return true
  return false
}

/** 打开一个表格文件给表格页 */
export async function openTable(dir: string, rel: string, cfg: TablesConfig): Promise<TableDoc> {
  const { rel: r, full } = safeRel(dir, rel, cfg)
  const kind = tableKind(r)
  if (!kind) throw new Error(t('不是表格文件'))
  const info = await stat(full).catch(() => null)
  if (!info?.isFile()) throw new Error(t('文件不存在，可能已删除或路径写错：{path}', { path: r }))
  const base = { path: r, kind, size: info.size, mtime: info.mtime.toISOString() }
  if (kind === 'xls')
    return { ...base, sheets: [], readOnly: t('老的 .xls / .et 格式只能用表格软件打开，另存为 .xlsx 后能在这里看和改') }
  const { sheets, csv } = await parseTable(full)
  const truncated = sheets.some((s) => s.truncated)
  const readOnly = cfg.readOnly
    ? t('项目设置里把表格设成了只读')
    : truncated
      ? t('表格太大（单张表超过 {n} 万格），只读了前面一部分，不能在这里改', { n: TABLE_XLSX.sheetCells / 10000 })
      : undefined
  return { ...base, sheets, csv, ...(readOnly ? { readOnly } : {}), locked: await lockedByOffice(full) }
}
