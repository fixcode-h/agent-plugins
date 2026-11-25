import path from 'node:path'
import type { LayerProp } from '../../../shared/uasset/inherit.ts'
import type { TableColumn } from '../../../shared/uasset/table-defaults.ts'
import { c, readJson, writeJson } from '../../util.ts'

/**
 * C++ 类的默认值（文件里根本不存，ue/docs/uasset-offline-reader.md 第 6 节）：编辑器开着的时候按 UELink 的 props
 * 读 /Script/Engine.Default__CapsuleComponent 这类对象记下来，按项目存在数据目录；编辑器没开时离线读取拿它垫在文件里的值下面。
 * 离线读时没记过的路径先记进 wanted，下次编辑器开着时补（prime.ts）；C++ 改了以后旧值会过时，所以记下超过一天的也会顺手重读。
 * 数据表的行结构也记在这里（键是行结构路径，columns 是各列默认值，shared/uasset/table-defaults.ts）：
 * 待补的写成「行结构@表」，因为要拿这张表在编辑器里读一遍才推得出默认值。
 */

export interface NativeEntry {
  at: number
  props?: LayerProp[]
  /** 行结构：各列的默认值 */
  columns?: TableColumn[]
  /** 编辑器里也没有这个对象（例如父类默认对象下面没有这个名字的子对象）：别再问 */
  missing?: true
}

interface CacheFile {
  v: 1
  entries: Record<string, NativeEntry>
  wanted: string[]
}

const mem = new Map<string, CacheFile>() // 模块状态：数据目录里那份的内存副本
const loading = new Map<string, Promise<CacheFile>>()
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

const fileOf = (projectId: string) => path.join(c().dataDir, 'uasset-defaults', `${encodeURIComponent(projectId)}.json`)

async function load(projectId: string): Promise<CacheFile> {
  const hit = mem.get(projectId)
  if (hit) return hit
  let p = loading.get(projectId)
  if (!p) {
    p = readJson<Partial<CacheFile>>(fileOf(projectId), {}).then((raw) => {
      const f: CacheFile = {
        v: 1,
        entries: raw.v === 1 && raw.entries ? raw.entries : {},
        wanted: raw.v === 1 && Array.isArray(raw.wanted) ? raw.wanted : [],
      }
      mem.set(projectId, f)
      loading.delete(projectId)
      return f
    })
    loading.set(projectId, p)
  }
  return p
}

/** 攒一会儿再写：一次补几十个类，不每个都写一遍文件 */
function save(projectId: string) {
  clearTimeout(saveTimers.get(projectId))
  saveTimers.set(
    projectId,
    setTimeout(() => {
      saveTimers.delete(projectId)
      const f = mem.get(projectId)
      if (f) void writeJson(fileOf(projectId), f).catch(() => {})
    }, 2000),
  )
  // 不为了这次写盘拖住进程退出（单测、插件停用）
  saveTimers.get(projectId)?.unref?.()
}

export async function nativeDefaults(projectId: string, objPath: string): Promise<NativeEntry | undefined> {
  return (await load(projectId)).entries[objPath]
}

/** 待补的键：对象路径，或者「行结构@表」（记下时存在行结构路径下） */
const keyOf = (want: string) => want.split('@')[0]

/** 离线读到一半发现没记过：记下来，编辑器开着时补。force：记过但不够用（数据表新出现了没默认值的列）也再补一次 */
export async function wantNative(projectId: string, want: string, force = false) {
  const f = await load(projectId)
  if ((!force && f.entries[keyOf(want)]) || f.wanted.includes(want)) return
  f.wanted.push(want)
  if (f.wanted.length > 500) f.wanted.splice(0, f.wanted.length - 500)
  save(projectId)
}

export async function putNative(projectId: string, objPath: string, entry: NativeEntry) {
  const f = await load(projectId)
  f.entries[objPath] = entry
  f.wanted = f.wanted.filter((x) => keyOf(x) !== objPath)
  save(projectId)
}

const STALE_MS = 24 * 3600 * 1000
export const isStale = (e: NativeEntry, now = Date.now()) => now - e.at > STALE_MS

/** 这一轮要问编辑器的：先补缺的，再重读记下超过一天的（旧的先） */
export async function nativeToFetch(projectId: string, limit: number, now = Date.now()): Promise<string[]> {
  const f = await load(projectId)
  // 行结构的重读要知道是哪张表，记下时没留，靠离线读时再 want 一次（wanted 带着表）
  const stale = Object.entries(f.entries)
    .filter(([, e]) => isStale(e, now) && !e.columns)
    .sort((x, y) => x[1].at - y[1].at)
    .map(([k]) => k)
  return [...f.wanted, ...stale].slice(0, limit)
}

/** 单测用：清掉内存副本 */
export const resetNativeCache = () => mem.clear()
