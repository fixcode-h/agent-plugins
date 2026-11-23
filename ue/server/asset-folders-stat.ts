import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ChildItem } from './asset-folders-disk.ts'
import { vcsCmd } from './vcs.ts'

/**
 * 资源页右栏「文件夹内容」表的状态列（设计稿「UE 插件优化与扩展」三.3、二 P1 资源整理）里不碰桥接的那一半：
 * 磁盘大小和修改时间直接 stat 文件，P4 签出状态问 p4 fstat。未保存、未被引用要问编辑器，在 asset-folders.ts。
 * 单独一个文件，单测不用拉起整个插件
 */

/** 文件夹内容表一行的状态；拿不到的字段不给（没开编辑器时没有 dirty / refs，不是 P4 项目没有 vcs） */
export interface ItemStat {
  /** 磁盘上 .uasset / .umap 的字节数；还没存过盘的新资源不给 */
  size?: number
  /** 修改时间（ISO） */
  mtime?: string
  /** 在编辑器里改了没保存 */
  dirty?: boolean
  /** P4：自己签出的动作（edit / add / delete…）、别人签出的人（user@workspace） */
  vcs?: { action?: string; others?: string[] }
  /** 引用它的包数（资源注册表，含软引用）；0 就是「未被引用」 */
  refs?: number
}
export type StatItem = ChildItem & ItemStat

/** 这一层的整体情况：界面按它决定状态列显示什么、写什么提示 */
export interface FolderStat {
  /** 有编辑器（或后台编辑器）答了未保存 / 引用 */
  editor: boolean
  /** P4 状态读不到时的原因（p4 没装、没登录……），原样给用户看 */
  vcsError?: string
  /** 查引用时超过上限没查的个数 */
  refsSkipped?: number
}

const ASSET_FILE = /\.(uasset|umap)$/i
const key = (name: string) => name.toLowerCase()
/** /Game/A/B.B → B */
export const nameOf = (objPath: string) => {
  const pkg = objPath.split(':')[0].split('.')[0]
  return pkg.slice(pkg.lastIndexOf('/') + 1)
}

/** 目录里每个资源文件的大小和修改时间，按资源名（不分大小写）；目录读不了就空 */
export async function diskStats(dir: string) {
  const out = new Map<string, { size: number; mtime: string; file: string }>()
  if (!dir) return out
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    ents
      .filter((e) => e.isFile() && ASSET_FILE.test(e.name))
      .map(async (e) => {
        const file = path.join(dir, e.name)
        const st = await stat(file).catch(() => undefined)
        if (st) out.set(key(e.name.replace(ASSET_FILE, '')), { size: st.size, mtime: st.mtime.toISOString(), file })
      }),
  )
  return out
}

/**
 * p4 -ztag fstat 的输出 → 按资源名的签出状态。一条记录一段（空行分开），字段行是「... 名 值」。
 * 只留有人签出的：自己签出看 action，别人签出看 otherOpenN（user@workspace）
 */
export function parseFstat(out: string) {
  const res = new Map<string, NonNullable<ItemStat['vcs']>>()
  for (const block of out.split(/\r?\n\s*\r?\n/)) {
    const f = new Map<string, string>()
    for (const line of block.split(/\r?\n/)) {
      const m = /^\.\.\. (\w+) ?(.*)$/.exec(line.trim())
      if (m) f.set(m[1], m[2])
    }
    const file = f.get('clientFile')
    if (!file || !ASSET_FILE.test(file)) continue
    const others = [...f.entries()].filter(([k]) => /^otherOpen\d+$/.test(k)).map(([, v]) => v)
    const action = f.get('action')
    if (!action && !others.length) continue
    const base = file.replace(/\\/g, '/').split('/').pop() ?? ''
    res.set(key(base.replace(ASSET_FILE, '')), { ...(action ? { action } : {}), ...(others.length ? { others } : {}) })
  }
  return res
}

/** 一层目录（不递归）里文件的 P4 签出状态。p4 报错时把原因带回去，不抛：大小、未保存照样能看 */
export async function p4Stats(root: string, dir: string) {
  if (!dir) return { map: new Map<string, NonNullable<ItemStat['vcs']>>() }
  const r = await vcsCmd('p4', ['-ztag', '-d', root, 'fstat', path.join(dir, '*')], { cwd: root, timeout: 20000 })
  const map = parseFstat(r.out)
  // 「no such file(s)」「not in client view」是这一层没有入库的文件，不算出错
  const err = r.err
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/no such file|not in client view|not under client/i.test(l))
    .join('\n')
    .trim()
  return { map, error: r.code !== 0 && !map.size && err ? err : undefined }
}

/** 把磁盘、P4 的结果并到这一层的资源上 */
export function mergeStats(
  items: ChildItem[],
  disk: Map<string, { size: number; mtime: string }>,
  vcs: Map<string, NonNullable<ItemStat['vcs']>>,
): StatItem[] {
  return items.map((it) => {
    const k = key(nameOf(it.path))
    const d = disk.get(k)
    const v = vcs.get(k)
    return { ...it, ...(d ? { size: d.size, mtime: d.mtime } : {}), ...(v ? { vcs: v } : {}) }
  })
}
