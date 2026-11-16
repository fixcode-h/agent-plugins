/**
 * 表格文件列表的增量：后台重新扫描表格目录后，服务端拿新旧两份列表算出增删改（diffTablesIndex），
 * 推给表格页，页面按它更新手上的列表（applyTablesDelta），不用整份重新请求几万个文件。
 */
import type { TableFile, TablesIndex } from './tables.ts'

/** 增量超过这么多条就不逐条推了，让页面整份重新取（服务端这时内存里已经是新的，取一次很快） */
export const MAX_LIST_DELTA = 3000

/** 后台扫描完推给表格页的事件名 */
export const TABLES_LIST_EVENT = 'tables-list'
/** 扫描进度推给表格页的事件名 */
export const TABLES_PROGRESS_EVENT = 'tables-list-progress'

/** 扫描进度：页面第一次打开还没有列表时按 projects 认，后台重扫时按 key 认 */
export interface TablesListProgress {
  key: string
  projects: string[]
  /** 已找到的表格数 */
  found: number
  /** 已看过的目录数 */
  dirs: number
  /** 正在看的目录或文件（相对项目目录） */
  at: string
}

export type TablesListDelta = { key: string } & (
  | { reload: true }
  | {
      add: TableFile[]
      /** 没了的文件路径 */
      remove: string[]
      /** 格式变了的（同名换了种表格；列表不带大小和修改时间，内容改了不算） */
      change: TableFile[]
      dirs: string[]
      missing: string[]
      roots?: TablesIndex['roots']
      truncated?: boolean
    }
)

/** 文件列表的排序：按路径，数字按大小、不分大小写（扫描和合并增量用同一个） */
export const byTablePath = (a: TableFile, b: TableFile) =>
  a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' })

const sameFile = (a: TableFile, b: TableFile) => a.kind === b.kind

/** 新旧两份列表的差别；完全一样返回 null */
export function diffTablesIndex(key: string, old: TablesIndex, next: TablesIndex): TablesListDelta | null {
  const before = new Map(old.files.map((f) => [f.path, f]))
  const add: TableFile[] = []
  const change: TableFile[] = []
  for (const f of next.files) {
    const o = before.get(f.path)
    if (!o) add.push(f)
    else if (!sameFile(o, f)) change.push(f)
    before.delete(f.path)
  }
  const remove = [...before.keys()]
  const meta = (i: TablesIndex) => JSON.stringify([i.dirs, i.missing, i.roots ?? [], !!i.truncated])
  if (!add.length && !change.length && !remove.length && meta(old) === meta(next)) return null
  if (add.length + change.length + remove.length > MAX_LIST_DELTA) return { key, reload: true }
  return listDelta(key, next, add, remove, change)
}

/** 一份增量（全空的就是「扫完了，没变化」） */
export function listDelta(
  key: string,
  next: TablesIndex,
  add: TableFile[] = [],
  remove: string[] = [],
  change: TableFile[] = [],
): TablesListDelta {
  return {
    key,
    add,
    remove,
    change,
    dirs: next.dirs,
    missing: next.missing,
    ...(next.roots ? { roots: next.roots } : {}),
    ...(next.truncated ? { truncated: true } : {}),
  }
}

/** 把增量合进页面手上的列表（整份重取的那种返回 null，由调用方去取） */
export function applyTablesDelta(index: TablesIndex, d: TablesListDelta): TablesIndex | null {
  if ('reload' in d) return null
  // 新加的也先从手上的去掉：页面可能已经等到过新列表（刷新按钮），同一份增量再合一次不能多出重复的
  const gone = new Set([...d.remove, ...d.add.map((f) => f.path)])
  const changed = new Map(d.change.map((f) => [f.path, f]))
  const files = index.files.filter((f) => !gone.has(f.path)).map((f) => changed.get(f.path) ?? f)
  if (d.add.length) {
    files.push(...d.add)
    files.sort(byTablePath)
  }
  const { truncated: _t, roots: _r, ...rest } = index
  return {
    ...rest,
    files,
    dirs: d.dirs,
    missing: d.missing,
    ...(d.roots ? { roots: d.roots } : {}),
    ...(d.truncated ? { truncated: true } : {}),
    scanning: false,
  }
}
