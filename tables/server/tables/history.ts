/**
 * 表格的版本记录：列出这个文件的历次提交、取某一版的内容（面板的 server/exec/vcs-history.ts，UE 资源的版本差异也用它），
 * 按同一套解析器读成工作表，交给页面做格子级差异。这里只读；把本地文件换成某一版的内容见 checkout.ts。
 */
import type { SheetData } from '../../shared/files.ts'
import { vcsRun } from '../exec/vcs-run.ts'
import {
  fileAt,
  fileHistory,
  gitVcs,
  MOVING_REV,
  VcsInputError,
  type FileHistory,
  type FileRev,
} from '../exec/vcs-history.ts'
import { parseTableBuffer } from './files.ts'
import { HttpError } from './http-error.ts'

export type TableRev = FileRev
export type TableHistory = FileHistory

// 版本控制命令转出去给 vcs-ops 等用
export { gitVcs, vcsRun }

export const tableHistory = (dir: string, rel: string): Promise<TableHistory> => fileHistory(dir, rel)

/** 取过的旧版本内容：提交过的版本不会再变，按「目录 + 路径 + 版本」留着（HEAD / #have / BASE 会变，不留） */
const atCache = new Map<string, SheetData[]>() // 模块状态：缓存，丢了重算
const AT_CACHE = 24

/** 某一版的内容：不在那一版里（新加的文件）时返回空表 */
export async function tableAt(dir: string, rel: string, rev: string): Promise<SheetData[]> {
  const key = `${dir}\n${rel}\n${rev}`
  const hit = atCache.get(key)
  if (hit) return hit
  const buf = await rawAt(dir, rel, rev)
  const sheets = buf ? (await parseTableBuffer(rel, buf)).sheets : []
  if (!MOVING_REV.test(rev)) {
    atCache.set(key, sheets)
    if (atCache.size > AT_CACHE) atCache.delete(atCache.keys().next().value!)
  }
  return sheets
}

/** 某一版文件的原始字节；那一版里还没有这个文件时返回 null。出错都转成 HttpError，原因原样给页面 */
export async function rawAt(dir: string, rel: string, rev: string): Promise<Buffer | null> {
  try {
    return await fileAt(dir, rel, rev)
  } catch (e) {
    if (e instanceof VcsInputError) throw new HttpError(e.message)
    throw new HttpError((e as Error).message)
  }
}
