/**
 * 表格文件列表的索引：每次扫描的结果存进插件数据目录（list-index/<键>.json），表格页打开时先把存下的给出去（马上显示），
 * 同时在后台重新走一遍表格目录，扫完把增删改推给页面（shared/table-list.ts），也写回索引。
 * 原来每次打开都现走目录：两万张表在 Windows 上光 stat 就要好几秒，页面一直转圈。
 *
 * - 内存里每组（项目目录 + 表格目录 + 包含 / 排除）一份最新列表；距上次扫完不到 rescanAfter 直接用，超了先给旧的、后台再扫。
 * - 同一组同时只扫一遍，几个请求一起等这一遍。
 * - forgetLists：新建、切版本这些会多出或少掉文件的操作之后调，下一次要等新扫的结果（不能给旧的）；
 *   保存这类只改内容的传 wait=false，只是让下次后台补扫。
 * - 没调 setListStore（单测）时不落盘、不推送，只有内存缓存。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PluginPages } from '../../../sdk/server.ts'
import type { TablesConfig, TablesIndex } from '../../shared/tables.ts'
import { TABLES_LIST_EVENT, diffTablesIndex, listDelta } from '../../shared/table-list.ts'
import { walkTables } from './files.ts'

/** 表格页取列表：距上次扫完超过这么久就后台再扫一遍 */
export const PAGE_RESCAN_MS = 5000
/** 搜索、检查、对比这些内部用的：一分钟内的列表直接用，不然每搜一次都要后台走一遍几万个文件 */
const RESCAN_MS = 60_000
/** 索引文件的格式版本：格式改了旧的直接不认，重新扫 */
const VERSION = 1
/** 内存里最多留这么多组 */
const MAX_ENTRIES = 50

interface Entry {
  dir: string
  cfg: TablesConfig
  index?: TablesIndex
  /** 上次扫完的时间；0 是还没扫过（手上的是磁盘上读来的） */
  at: number
  /** 下一次取列表要等新扫的结果 */
  stale?: boolean
  scan?: Promise<TablesIndex>
  load?: Promise<TablesIndex | undefined>
}

let store: { dir: string; pages?: PluginPages } | undefined // 模块状态：插件启动时设一次
const entries = new Map<string, Entry>() // 模块状态：缓存，丢了从索引文件或重扫恢复

/** 插件启动时给：索引存哪、扫完推给谁 */
export function setListStore(s: { dir: string; pages?: PluginPages } | undefined) {
  store = s
  entries.clear()
}

const keyOf = (dir: string, cfg: TablesConfig) =>
  createHash('sha1')
    .update(JSON.stringify([dir, cfg.dirs, cfg.include, cfg.exclude]))
    .digest('hex')
    .slice(0, 16)

const fileOf = (key: string) => (store ? path.join(store.dir, 'list-index', `${key}.json`) : '')

async function readIndex(key: string): Promise<TablesIndex | undefined> {
  if (!store) return undefined
  try {
    const j = JSON.parse(await readFile(fileOf(key), 'utf8')) as { v?: number; index?: TablesIndex }
    return j.v === VERSION && Array.isArray(j.index?.files) ? j.index : undefined
  } catch {
    // 没有索引、读坏了：当没有，现扫一遍
    return undefined
  }
}

/** 先写临时文件再改名：写到一半进程没了，下次读到的还是旧的完整索引 */
async function writeIndex(key: string, index: TablesIndex) {
  if (!store) return
  const file = fileOf(key)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(tmp, JSON.stringify({ v: VERSION, at: new Date().toISOString(), index }))
    await rename(tmp, file)
  } catch {
    // 写不了（磁盘满、权限）：只是下次打开要现扫，列表照样能用
  }
}

/** 新建、删除、切版本之后：下次取列表等新扫的结果。wait=false（保存这类只改内容的）只让下次后台补扫 */
export function forgetLists(wait = true) {
  for (const e of entries.values()) {
    e.at = 0
    if (wait) e.stale = true
  }
}

/** 重走一遍目录；同一组正在扫就等那一遍（要等新结果时排在它后面再扫） */
function scan(key: string, e: Entry, fresh: boolean): Promise<TablesIndex> {
  const after = e.stale || fresh ? e.scan : undefined
  e.stale = false
  if (e.scan && !after) return e.scan
  const run = (async () => {
    if (after) await after.catch(() => {})
    const next = await walkTables(e.dir, e.cfg)
    const old = e.index
    e.index = next
    e.at = Date.now()
    const delta = old ? diffTablesIndex(key, old, next) : null
    if (!old || delta) void writeIndex(key, next)
    // 页面手上有旧列表的（拿到的是 scanning）：扫完都推一次，没变化也推，页面好收起「后台更新中」
    if (old) store?.pages?.push(TABLES_LIST_EVENT, delta ?? listDelta(key, next))
    return next
  })()
  e.scan = run
  void run
    .finally(() => {
      if (e.scan === run) e.scan = undefined
    })
    .catch(() => {})
  return run
}

const out = (key: string, index: TablesIndex, scanning: boolean): TablesIndex => ({
  ...index,
  key,
  ...(scanning ? { scanning: true } : {}),
})

/**
 * 列出表格目录里的全部表格文件（按路径排序）。
 * fresh（表格页的刷新按钮）：等重新扫完；rescanAfter：手上的列表比这旧就后台补扫，先返回手上的（带 scanning）
 */
export async function listTables(
  dir: string,
  cfg: TablesConfig,
  fresh = false,
  rescanAfter = RESCAN_MS,
): Promise<TablesIndex> {
  const key = keyOf(dir, cfg)
  let e = entries.get(key)
  if (!e) {
    entries.set(key, (e = { dir, cfg, at: 0 }))
    if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
  }
  if (fresh || e.stale) return out(key, await scan(key, e, fresh), false)
  if (!e.index) {
    e.load ??= readIndex(key)
    const disk = await e.load
    if (disk && !e.index) e.index = disk
  }
  if (!e.index) return out(key, await scan(key, e, false), false)
  if (Date.now() - e.at < rescanAfter) return out(key, e.index, !!e.scan)
  const had = e.index
  void scan(key, e, false).catch(() => {})
  return out(key, had, true)
}
