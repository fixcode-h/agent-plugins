import { ppost } from '../../api.ts'

/**
 * GameTest 场景库整理的接口（服务端 server/uekit/gt-library/，POST ext/gt/library）。路径都相对场景根，用 / 分隔，
 * 脚本带 .json；全部直接读写磁盘，UE 没连着也能用。
 */

/** movePlan：要跟着改的 call（按文件、旧 → 新） */
export interface MovePlan {
  path: string
  to: string
  dir: boolean
  /** 拖回原来的文件夹、改成同一个名字：什么也不用做 */
  same?: boolean
  /** 要挪的脚本个数 */
  scripts: number
  refs: { file: string; at: string; from: string; to: string }[]
}

/** deletePlan：会删的脚本、删了以后找不到被 call 的脚本的地方 */
export interface DeletePlan {
  path: string
  dir: boolean
  scripts: string[]
  callers: { file: string; at: string; script: string }[]
}

export interface MoveDone {
  path: string
  refs: number
  files: number
  history: number
}

export const libOp = <T>(project: string, root: string, action: string, args: Record<string, unknown> = {}) =>
  ppost<T>(project, 'ext/gt/library', { root, action, ...args })

/** 树里的路径（叶子不带 .json）换回场景文件的相对路径 */
export const scenarioPathOf = (treePath: string) => `${treePath}.json`

/** 选中的场景被挪走了：换成新路径（文件夹改名、移动时下面的都跟着走） */
export function followMove(sel: string | undefined, from: string, to: string, dir: boolean) {
  if (!sel) return undefined
  const low = sel.toLowerCase()
  const f = from.toLowerCase()
  if (dir ? low.startsWith(`${f}/`) : low === f) return dir ? `${to}${sel.slice(from.length)}` : to
  return undefined
}

/** 路径里的文件夹部分（脚本所在的文件夹，根是 ''） */
export const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
