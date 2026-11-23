import type { PluginFileIndex } from '../../sdk/server.ts'
import { c } from './util.ts'

/**
 * 面板的项目文件索引（面板插件接口 16，ctx.files）：插件里按目录找文件的地方（跳转索引、资源文件夹、Lua 文件清单……）
 * 先问它，不再各自递归走目录。旧面板没有、项目关了索引、目录不在索引里（排除目录）时返回 undefined，调用方照旧自己走。
 * 等就绪、按目录取、换相对路径都用面板开放的 server/file-index/indexed（和表格插件同一份），这里只把 ctx.files 接上、
 * 保留插件里一直在用的签名
 */
const panel = () => import('@panel/server/file-index/indexed')
const files = () => {
  try {
    return c().files
  } catch {
    return undefined
  }
}

/** 项目的索引（按面板项目 id） */
export async function projectFileIndex(projectId: string): Promise<PluginFileIndex | undefined> {
  return (await panel()).readyIndex(files(), projectId)
}

/** 按目录找到所在项目的索引（目录可以在项目外，例如引擎目录：要那个项目已经加载过） */
export async function dirFileIndex(dir: string): Promise<PluginFileIndex | undefined> {
  return (await panel()).readyIndex(files(), dir)
}

/**
 * root 下所有符合 want 的文件，返回相对 root 的路径（/ 分隔）；root 不在索引里返回 undefined。
 * idx 不给时按 root 找；ext 能给就给（整棵子树全拿出来很占内存）
 */
export async function indexedTree(
  root: string,
  want: RegExp,
  idx?: PluginFileIndex,
  ext?: string[],
): Promise<string[] | undefined> {
  return (await panel()).indexedTree(files(), root, { want, idx, ext })
}

/** 插件写了文件（新建、导出、改名）：报给面板马上进索引；旧面板没有这个接口就算了 */
export function touchIndexed(paths: string[]) {
  try {
    c().files?.touch(paths)
  } catch {
    // 面板那边出错不影响插件自己的写入
  }
}

/** root 下全部子目录（相对 root，/ 分隔）；root 不在索引里返回 undefined */
export async function indexedDirs(root: string): Promise<string[] | undefined> {
  return (await panel()).indexedDirs(files(), root)
}
