import type { FileRev } from '@panel/server/exec/vcs-history'
import { propValueIn, sameValue, type PropRef } from '../../shared/asset-diff/prop-history.ts'
import type { UeProject } from '../types.ts'
import { assetHistory, parseSource, snapshotOf } from './snapshot.ts'

/**
 * 属性的来历（设计稿「UE资源版本差异-修复与强化」3.6）：点了才从选中的那一版往回逐版读（快照有缓存，提交过的版本读一次就记住），
 * 读到这个值是哪一版改成这样的就停，回 next 让网页「继续往回」；一次最多读 max 版（设置 → 组件「版本差异」）。
 * 每版要 UE 加载一次（没缓存时几秒），所以不预先算
 */
export interface HistEntry {
  rev: string
  label: string
  author?: string
  time?: string
  message?: string
  found: boolean
  value?: unknown
  /** 和更早一版比，这一版改了这个值（或者这一版才有它） */
  changed: boolean
}

export async function propHistory(
  project: UeProject,
  pkg: string,
  ref: PropRef,
  opts: { start: string; offset: number; max: number },
): Promise<{ entries: HistEntry[]; next?: number }> {
  const hist = await assetHistory(project, pkg)
  const revs: FileRev[] = hist.revs
  // 起点：本地（编辑器里 / 磁盘上）或某一版；从它往回
  const startIdx = opts.start === 'live' || opts.start === 'disk' ? -1 : revs.findIndex((r) => r.id === opts.start)
  const seq: { rev: string; meta?: FileRev }[] = [
    ...(startIdx < 0 ? [{ rev: opts.start }] : []),
    ...revs.slice(Math.max(0, startIdx)).map((r) => ({ rev: r.id, meta: r })),
  ]
  const from = Math.max(0, opts.offset)
  const max = Math.min(Math.max(1, opts.max), 40)
  const read = async (i: number) => {
    const s = seq[i]
    const snap = await snapshotOf(project, pkg, parseSource(s.rev)!)
    return propValueIn(snap, ref)
  }
  const entries: HistEntry[] = []
  let cur = from < seq.length ? await read(from) : undefined
  let i = from
  while (cur && i < seq.length && entries.length < max) {
    const older = i + 1 < seq.length ? await read(i + 1) : { found: false }
    const s = seq[i]
    const changed = cur.found && (!older.found || !sameValue(cur.value, older.value))
    entries.push({
      rev: s.rev,
      label: s.meta?.label ?? (s.rev === 'live' ? 'live' : 'disk'),
      author: s.meta?.author,
      time: s.meta?.time,
      message: s.meta?.message,
      found: cur.found,
      ...(cur.found && { value: cur.value }),
      changed,
    })
    i++
    cur = older
    // 找到「这个值从哪一版来」就停：第一处改动之后再往回要用户点「继续往回」
    if (changed) break
    if (!cur.found) break
  }
  // 还没到头：给继续往回的起点
  return { entries, ...(cur?.found && i < seq.length && { next: i }) }
}
