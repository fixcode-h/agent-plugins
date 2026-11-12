/**
 * 表格页没保存的改动存进浏览器的 IndexedDB（草稿）：刷新页面、面板重启、浏览器崩了以后，重新打开这个文件还能恢复。
 * 只存「行操作 + 列操作 + 改了的格子（带改之前的值）」，不存整张表；按「项目 + 文件」一份，记着改动是在哪一版文件上做的
 * （打开时的修改时间、大小）。表格文件本身一个字节都不动，草稿只在这台机器的这个浏览器里。
 *
 * 恢复（planRestore）：
 * - 文件没在外面改过：原样放回，一步就能撤销；
 * - 改过、但草稿里只改了格子：按位置对，每格比较「文件里现在的值」和「草稿记的改之前的值」，
 *   一样的直接放回，文件里那格也变了的算冲突，让用户选用哪边；
 * - 改过、草稿里还插删过行列：位置已经对不上，只能「仍按原位置放回」（先提醒）或丢掉。
 */
import { applyOps, setCells, type CellSet, type ColOp, type RowOp } from '@shared/table-edit'
import type { SheetData } from '@shared/files'
import type { TableDoc } from '@shared/tables'
import { noEdits, pendingOf, type Edits } from './table-edits'

/** 草稿里的一格：v 是改成的值，o 是改之前（做完行列操作后那个位置上）的值 */
export interface DraftCell extends CellSet {
  o: string
}

export interface DraftSheet {
  name: string
  rows: RowOp[]
  cols?: ColOp[]
  cells: DraftCell[]
}

export interface Draft {
  v: 1
  projectId: string
  path: string
  /** 改动是在哪一版文件上做的 */
  mtime: string
  size: number
  savedAt: number
  sheets: DraftSheet[]
}

/** 草稿放多久：超过的打开表格页时清掉（改了一个月都没回来保存，多半不要了） */
export const DRAFT_TTL = 30 * 24 * 3600_000

/** 一个打开着的文件现在的草稿；没有要保存的改动时返回 null（该删掉已有的草稿） */
export function draftOf(projectId: string, doc: TableDoc, edits: Edits | undefined): Draft | null {
  const pending = pendingOf(edits, doc.sheets)
  if (!pending.length) return null
  const sheets = pending.map((p): DraftSheet => {
    const base = applyOps(doc.sheets.find((s) => s.name === p.name)?.rows ?? [], p.rows, p.cols)
    return {
      name: p.name,
      rows: p.rows,
      ...(p.cols?.length ? { cols: p.cols } : {}),
      cells: p.cells.map((c) => ({ ...c, o: base[c.r]?.[c.c] ?? '' })),
    }
  })
  return { v: 1, projectId, path: doc.path, mtime: doc.mtime, size: doc.size, savedAt: Date.now(), sheets }
}

/** 草稿一共几处改动（格子 + 行列操作），提示里用 */
export const draftCount = (d: Draft) =>
  d.sheets.reduce((n, s) => n + s.cells.length + s.rows.length + (s.cols?.length ?? 0), 0)

export interface RestorePlan {
  /** 文件在外面改过 */
  moved: boolean
  /** 草稿里插删过行列（文件又改过时位置对不上） */
  structural: boolean
  /** 能直接放回的格子数 */
  clean: number
  /** 两边都改了的格子：文件里现在的值、草稿里的值 */
  conflicts: { sheet: string; r: number; c: number; file: string; mine: string }[]
  /** 文件里已经没有的工作表 */
  missing: string[]
}

const findSheet = (doc: TableDoc, name: string): SheetData | undefined =>
  doc.sheets.find((s) => s.name === name) ?? (doc.sheets.length === 1 && doc.kind === 'csv' ? doc.sheets[0] : undefined)

/** 恢复前先看一遍：文件变没变、有没有冲突 */
export function planRestore(d: Draft, doc: TableDoc): RestorePlan {
  const moved = d.mtime !== doc.mtime || d.size !== doc.size
  const structural = d.sheets.some((s) => s.rows.length || s.cols?.length)
  const plan: RestorePlan = { moved, structural, clean: 0, conflicts: [], missing: [] }
  for (const s of d.sheets) {
    const sheet = findSheet(doc, s.name)
    if (!sheet) {
      plan.missing.push(s.name)
      continue
    }
    if (!moved || structural) {
      plan.clean += s.cells.length
      continue
    }
    for (const c of s.cells) {
      const now = sheet.rows[c.r]?.[c.c] ?? ''
      // 文件里那格没变（还是改之前的值），或者已经是我要改成的值：都不算冲突
      if (now === c.o || now === c.v) plan.clean++
      else plan.conflicts.push({ sheet: s.name, r: c.r, c: c.c, file: now, mine: c.v })
    }
  }
  return plan
}

/**
 * 按草稿做出改动（一个文件一份 Edits，恢复是一步、能撤销）。
 * keep：冲突的格子用哪边——mine 用草稿里的，file 留文件里现在的
 */
export function restoreEdits(d: Draft, doc: TableDoc, keep: 'mine' | 'file' = 'mine'): Edits {
  const plan = planRestore(d, doc)
  const skip = new Set(keep === 'file' ? plan.conflicts.map((x) => `${x.sheet}:${x.r}:${x.c}`) : [])
  let e = noEdits()
  for (const s of d.sheets) {
    const sheet = findSheet(doc, s.name)
    if (!sheet) continue
    const cells = s.cells.filter((c) => !skip.has(`${s.name}:${c.r}:${c.c}`)).map(({ r, c, v }) => ({ r, c, v }))
    const cols = s.cols ?? []
    const rows = setCells(applyOps(sheet.rows, s.rows, cols), cells)
    e = {
      sheets: { ...e.sheets, [sheet.name]: { rows, ops: s.rows, ...(cols.length ? { cols } : {}) } },
      undo: [...e.undo, { sheet: sheet.name, before: undefined }],
      redo: [],
    }
  }
  return e
}

// ---- IndexedDB：读写失败（隐私模式、配额满了）一律当作没有草稿，不影响编辑 ----

const DB = 'agent-panel-tables'
const STORE = 'drafts'
const keyOf = (projectId: string, path: string) => `${projectId}\n${path}`

let dbp: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbp
}

function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise((resolve) => {
        if (!d) return resolve(undefined)
        try {
          const req = f(d.transaction(STORE, mode).objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}

export const putDraft = (d: Draft) => run('readwrite', (s) => s.put(d, keyOf(d.projectId, d.path)))
export const dropDraft = (projectId: string, path: string) => run('readwrite', (s) => s.delete(keyOf(projectId, path)))
export const getDraft = (projectId: string, path: string) =>
  run<Draft | undefined>('readonly', (s) => s.get(keyOf(projectId, path)) as IDBRequest<Draft | undefined>).then((d) =>
    d?.v === 1 ? d : undefined,
  )

/** 一个项目的所有草稿（只要路径和时间）；顺手清掉过期的 */
export async function listDrafts(projectId: string): Promise<{ path: string; savedAt: number; count: number }[]> {
  const prefix = keyOf(projectId, '')
  const all =
    (await run<Draft[]>('readonly', (s) => s.getAll(IDBKeyRange.bound(prefix, `${prefix}￿`)) as IDBRequest<Draft[]>)) ??
    []
  const now = Date.now()
  const out: { path: string; savedAt: number; count: number }[] = []
  for (const d of all) {
    if (d?.v !== 1) continue
    if (now - d.savedAt > DRAFT_TTL) void dropDraft(projectId, d.path)
    else out.push({ path: d.path, savedAt: d.savedAt, count: draftCount(d) })
  }
  return out
}
