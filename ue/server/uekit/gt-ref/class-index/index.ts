import { createHash } from 'node:crypto'
import path from 'node:path'
import type { GtClassIndexResult, GtClassRow } from '../../../../shared/gt-script/ref/types.ts'
import type { UeProject } from '../../../types.ts'
import { c, readJson, t, writeJson } from '../../../util.ts'

/**
 * 「类」下拉的本地索引（网页 gt.classes all: true）。用户 2026-11-23：每次打开下拉都「读类树…」重读、搜索每个字都问一次很慢。
 * 做法：整张类表（UE 开着且 GameTest ≥ 2.4.0 时问 UE 要，否则从项目文件读）在这里按项目记在内存并存进数据目录，
 * 网页一问马上给记住的那份，同时后台重建；网页带 wait 再问一次拿重建后的（内容没变回 same，不重发整表）。
 * 「刷新」带 fresh：UE 和磁盘都不用缓存，等新表建好再回。
 */

type A = Record<string, unknown>

interface Entry {
  v: string
  rows: GtClassRow[]
  source: 'ue' | 'disk'
  note?: string
  /** 建好的时间；从数据目录读回来的算 0（一定要后台重建一次） */
  at: number
}

export interface ClassIndexDeps {
  /** 问 UE 要整表（gt.classes all）：UE 没开抛错；GameTest 旧于 2.4.0 时回的没有 rows */
  live: (lua: boolean, fresh: boolean) => Promise<A>
  /** 磁盘上的类表（offline/classes.ts 的 offlineRows） */
  disk: (lua: boolean, fresh: boolean) => Promise<GtClassRow[]>
}

/** 这么久内再来问不重建：网页连着开关下拉、换页签不反复让 UE 重扫 */
const MIN_GAP_MS = 5000

const mem = new Map<string, Entry>()
const building = new Map<string, Promise<Entry>>()

const keyOf = (p: Pick<UeProject, 'id'>, lua: boolean) => `${p.id}:${lua ? 'lua' : 'ue'}`
const fileOf = (p: Pick<UeProject, 'id'>, lua: boolean) =>
  path.join(c().dataDir, 'class-index', `${encodeURIComponent(p.id)}-${lua ? 'lua' : 'ue'}.json`)

/** Lua 模块名对得上就行：大小写、/ 和 . 不敏感（和 gt-ref/ops.ts 的 withLiveCounts 一致） */
const norm = (s: string) => s.replace(/[/\\]/g, '.').toLowerCase()

const liveRowsOf = (r: A | undefined) => (Array.isArray(r?.rows) ? (r.rows as GtClassRow[]) : undefined)

/** 纯逻辑（单测用）：UE 回的和磁盘的合成一张表，写清楚来源和要给界面看的说明 */
export function mergeRows(
  lua: boolean,
  live: A | undefined,
  why: string,
  disk: GtClassRow[] | undefined,
): Omit<Entry, 'v' | 'at'> {
  const liveRows = liveRowsOf(live)
  const liveNote = typeof live?.note === 'string' ? live.note : undefined
  if (lua) {
    // Lua 以磁盘上的源码为准（UE 只认已经 require 过的模块），UE 只拿来补此刻的实例数
    if (disk?.length) {
      if (!liveRows) return { rows: disk, source: 'disk', note: live ? undefined : t('UE 没在运行，没有此刻实例数') }
      const counts = new Map(liveRows.map((r) => [norm(r[0]), r[4]]))
      return {
        rows: disk.map((r) => {
          const n = counts.get(norm(r[0]))
          return n ? [r[0], r[1], r[2], r[3], n] : r
        }),
        source: 'ue',
        ...(liveNote ? { note: liveNote } : {}),
      }
    }
    if (liveRows) return { rows: liveRows, source: 'ue', ...(liveNote ? { note: liveNote } : {}) }
    return { rows: [], source: 'disk', note: why || undefined }
  }
  if (liveRows) return { rows: liveRows, source: 'ue', ...(liveNote ? { note: liveNote } : {}) }
  return {
    rows: disk ?? [],
    source: 'disk',
    note: live
      ? t(
          '编辑器里的 GameTest 旧于 2.4.0：类树先按项目文件列（引擎类只有常见的几个），升级 GameTest 后列出全部已加载的类',
        )
      : t('UE 没在运行，类树从项目文件读，没有此刻实例数（{why}）', { why }),
  }
}

async function build(p: UeProject, lua: boolean, fresh: boolean, deps: ClassIndexDeps): Promise<Entry> {
  let live: A | undefined
  let why = ''
  try {
    live = await deps.live(lua, fresh)
  } catch (e) {
    why = (e as Error).message ?? String(e)
  }
  // UObject 类树 UE 给了整表就不必扫磁盘；Lua 始终以磁盘为准
  const needDisk = lua || !liveRowsOf(live)
  const disk = needDisk ? await deps.disk(lua, fresh).catch(() => undefined) : undefined
  if (!live && !disk) throw new Error(why || t('读不到类表'))
  const merged = mergeRows(lua, live, why, disk)
  const v = createHash('sha1').update(JSON.stringify(merged.rows)).digest('hex').slice(0, 16)
  return { ...merged, v, at: Date.now() }
}

/** 重建（同时来的共用一次；刚建过的不重建，fresh 除外）；建好记内存、存数据目录 */
function rebuild(p: UeProject, lua: boolean, fresh: boolean, deps: ClassIndexDeps): Promise<Entry> {
  const key = keyOf(p, lua)
  const running = building.get(key)
  if (running) return running
  const have = mem.get(key)
  if (!fresh && have && Date.now() - have.at < MIN_GAP_MS) return Promise.resolve(have)
  const job = build(p, lua, fresh, deps)
    .then((e) => {
      mem.set(key, e)
      // 存盘失败不影响这次（下次打开面板只是要等一次重建）
      writeJson(fileOf(p, lua), { ...e, at: 0 }).catch(() => undefined)
      return e
    })
    .finally(() => building.delete(key))
  building.set(key, job)
  return job
}

async function remembered(p: UeProject, lua: boolean): Promise<Entry | undefined> {
  const key = keyOf(p, lua)
  const hit = mem.get(key)
  if (hit) return hit
  const saved = await readJson<Entry | undefined>(fileOf(p, lua), undefined)
  if (!saved || typeof saved.v !== 'string' || !Array.isArray(saved.rows)) return undefined
  const e = { ...saved, at: 0 }
  if (!mem.has(key)) mem.set(key, e)
  return mem.get(key)
}

export async function classIndex(p: UeProject, args: A, deps: ClassIndexDeps): Promise<GtClassIndexResult> {
  const lua = args.lua === true
  const fresh = args.fresh === true
  const have = typeof args.v === 'string' ? args.v : ''
  let e = fresh ? undefined : await remembered(p, lua)
  let refreshing = false
  if (!e || fresh) e = await rebuild(p, lua, fresh, deps)
  else if (args.wait === true)
    // 网页手里是旧的、等重建：重建失败（UE 刚关）就回记住的那份，不让下拉报错
    e = await rebuild(p, lua, false, deps).catch(() => e!)
  else if (Date.now() - e.at >= MIN_GAP_MS) {
    refreshing = true
    rebuild(p, lua, false, deps).catch(() => undefined)
  }
  return {
    v: e.v,
    source: e.source,
    total: e.rows.length,
    ...(e.note ? { note: e.note } : {}),
    ...(refreshing ? { refreshing } : {}),
    ...(have === e.v ? { same: true } : { rows: e.rows }),
  }
}

/** 单测用：清掉内存里记的（模拟面板重启，只剩数据目录里存的） */
export function _forgetForTest() {
  mem.clear()
  building.clear()
}
