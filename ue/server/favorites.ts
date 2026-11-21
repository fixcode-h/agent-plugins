import { existsSync } from 'node:fs'
import { ueDocFile } from './doc-root.ts'
import { patchLocal, readLocal } from './store.ts'
import type { UeProject } from './types.ts'
import { readJson, t, writeJson } from './util.ts'

/**
 * 资源页收藏的文件夹：存在项目文档根里，可以提交、团队共用；以前存在插件数据目录（store.ts 的 local.folders），第一次读时搬过来。
 * 以前设置里还能选存项目的 .agent-panel/ue，2026-11-21 用户定统一存文档根，选过的读项目时搬过去（doc-root.ts 的 adoptProjectStore）
 */
export interface FavFile {
  folders: string[]
}

/** 最多收藏多少个：再多收藏夹就失去意义了 */
const MAX = 100

type P = Pick<UeProject, 'id' | 'root'>

/**
 * 收藏文件的位置：项目文档根（面板给的，见 doc-root.ts）的 AgentPanel/UE/favorites.json。
 * read 是读的位置：升级前存在旧文档根的照样读得到
 */
export const favPaths = (p: P) => ueDocFile(p, 'favorites.json')

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
