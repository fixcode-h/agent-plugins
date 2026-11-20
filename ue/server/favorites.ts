import { existsSync } from 'node:fs'
import path from 'node:path'
import { ueDocFile } from './doc-root.ts'
import { patchLocal, readLocal } from './store.ts'
import type { UeProject } from './types.ts'
import { readJson, t, writeJson } from './util.ts'

/**
 * 资源页收藏的文件夹（用户 2026-11-16：收藏存到项目的 docs 里某个文件夹，或项目的 .agent-panel 文件夹，设置里可选）。
 * 两处都在项目里，可以提交、团队共用；以前存在插件数据目录（store.ts 的 local.folders），第一次读时搬过来。
 */
export interface FavFile {
  folders: string[]
}

/** 最多收藏多少个：再多收藏夹就失去意义了 */
const MAX = 100

type P = Pick<UeProject, 'id' | 'root' | 'favStore'>

/**
 * 收藏文件的位置：项目文档根（面板给的，见 doc-root.ts）的 AgentPanel/UE/favorites.json，
 * 或 .agent-panel/ue/favorites.json（和 GM 预设 gm.json 放一起）。read 是读的位置：升级前存在旧文档根的照样读得到
 */
export function favPaths(p: P) {
  if (p.favStore !== 'project') return ueDocFile(p, 'favorites.json')
  const f = path.join(p.root, '.agent-panel', 'ue', 'favorites.json')
  return { read: f, write: f }
}

/** 收藏文件写在哪（设置页显示的位置） */
export const favFile = (p: P) => favPaths(p).write

const clean = (list: unknown) =>
  Array.isArray(list)
    ? [...new Set(list.filter((x): x is string => typeof x === 'string' && x.startsWith('/')))].slice(0, MAX)
    : []

export async function readFavs(p: UeProject): Promise<{ folders: string[]; file: string }> {
  const { read, write: file } = favPaths(p)
  if (existsSync(read)) return { folders: clean((await readJson<Partial<FavFile>>(read, {})).folders), file }
  // 一次性搬家：以前存在插件数据目录里的收藏写进项目，旧的清掉
  const old = (await readLocal(p.id)).folders ?? []
  if (old.length) {
    await writeJson(file, { folders: clean(old) } satisfies FavFile)
    await patchLocal(p.id, { folders: [] })
  }
  return { folders: clean(old), file }
}

/**
 * 改收藏：按动作改而不是整份覆盖，文件是团队共用的，别人刚加的不被网页上的旧列表盖掉。
 * add 加到末尾；remove 删掉；move 把 path 挪到 to 的位置（拖动排序 / 上移下移）
 */
export async function editFavs(p: UeProject, b: { action?: unknown; path?: unknown; to?: unknown }) {
  const { folders, file } = await readFavs(p)
  const at = String(b.path ?? '')
  let next = folders.filter((x) => x !== at)
  if (b.action === 'add') next.push(at)
  else if (b.action === 'move') {
    const to = Math.max(0, Math.min(next.length, Number(b.to) || 0))
    next = [...next.slice(0, to), at, ...next.slice(to)]
  } else if (b.action !== 'remove') throw new Error(t('不认识的操作：{a}', { a: String(b.action) }))
  const out = clean(next)
  await writeJson(file, { folders: out } satisfies FavFile)
  return { folders: out, file }
}

/** 设置里换了存放位置：新位置还没有文件就把现有的带过去，有了就两边合并（新位置的在前） */
export async function moveFavs(from: UeProject, to: UeProject) {
  if (favFile(from) === favFile(to)) return
  const old = (await readFavs(from)).folders
  const file = favFile(to)
  const cur = existsSync(file) ? clean((await readJson<Partial<FavFile>>(file, {})).folders) : []
  await writeJson(file, { folders: clean([...cur, ...old]) } satisfies FavFile)
}
