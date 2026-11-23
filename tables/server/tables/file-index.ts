/**
 * 面板的项目文件索引（面板插件接口 16，ctx.files）：列表格文件、找枚举扫描的源文件先问它，不再各自递归走目录。
 * 旧面板没有、项目关了索引、目录不在索引里（排除目录）、3 秒内还没建好时返回 undefined，调用方照旧自己走
 */
import type { PluginFiles } from '../../../sdk/server.ts'

let files: PluginFiles | undefined // 模块状态：接线，activate 时设
const READY_MS = 3_000

export function setFileIndex(f: PluginFiles | undefined) {
  files = f
}

const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** root 下全部文件，相对 root（/ 分隔）；不在索引里返回 undefined */
export async function indexedFiles(root: string): Promise<string[] | undefined> {
  try {
    const idx = await files?.index(root)
    if (!idx || !(await idx.ready(READY_MS)) || idx.has(root) !== 'dir') return undefined
    const r = await idx.list(root, { recursive: true })
    if (!r) return undefined
    const pre = `${slash(root)}/`
    const ci = process.platform === 'win32'
    const cmp = ci ? pre.toLowerCase() : pre
    return r.files
      .map(slash)
      .filter((f) => (ci ? f.toLowerCase() : f).startsWith(cmp))
      .map((f) => f.slice(pre.length))
  } catch {
    return undefined
  }
}

/** 插件写了文件（新建表格、导出）：报给面板马上进索引 */
export function touchIndexed(paths: string[]) {
  try {
    files?.touch(paths)
  } catch {
    // 面板那边出错不影响写入
  }
}
