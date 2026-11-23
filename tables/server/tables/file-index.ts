/**
 * 面板的项目文件索引（面板插件接口 16，ctx.files）：列表格文件、找枚举扫描的源文件先问它，不再各自递归走目录。
 * 旧面板没有、项目关了索引、目录不在索引里（排除目录）、3 秒内还没建好时返回 undefined，调用方照旧自己走。
 * 等就绪、按目录取、换相对路径都用面板开放的 server/file-index/indexed（和 UE 插件同一份）
 */
import type { PluginFiles } from '../../../sdk/server.ts'
import { indexedTree, touchIndexed as touch } from '../file-index/indexed.ts'

let files: PluginFiles | undefined // 模块状态：接线，activate 时设

export function setFileIndex(f: PluginFiles | undefined) {
  files = f
}

/** root 下的文件，相对 root（/ 分隔）；不在索引里返回 undefined。ext 能给就给：整棵树全拿出来很占内存 */
export const indexedFiles = (root: string, ext?: string[]) => indexedTree(files, root, { ext })

/** 插件写了文件（新建表格、导出）：报给面板马上进索引 */
export const touchIndexed = (paths: string[]) => touch(files, paths)
