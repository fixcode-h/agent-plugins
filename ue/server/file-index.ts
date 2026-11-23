import type { PluginFileIndex } from '../../sdk/server.ts'
import { c } from './util.ts'

/**
 * 面板的项目文件索引（面板插件接口 16，ctx.files）：插件里按目录找文件的地方（跳转索引、资源文件夹、Lua 文件清单……）
 * 先问它，不再各自递归走目录。旧面板没有、项目关了索引、目录不在索引里（排除目录）时返回 undefined，调用方照旧自己走。
 *
 * 等索引第一次建好最多 READY_MS：大项目第一次建要十几秒，界面上的请求不干等，这次照旧自己扫
 */
const READY_MS = 3_000

/** 项目的索引（按面板项目 id） */
export async function projectFileIndex(projectId: string): Promise<PluginFileIndex | undefined> {
  try {
    const idx = await c().files?.index(projectId)
    if (!idx || !(await idx.ready(READY_MS))) return undefined
    return idx
  } catch {
    return undefined
  }
}

/** 按目录找到所在项目的索引（目录可以在项目外，例如引擎目录：要那个项目已经加载过） */
export async function dirFileIndex(dir: string): Promise<PluginFileIndex | undefined> {
  try {
    const idx = await c().files?.index(dir)
    if (!idx || !(await idx.ready(READY_MS))) return undefined
    return idx
  } catch {
    return undefined
  }
}

const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * root 下所有符合 want 的文件，返回相对 root 的路径（/ 分隔）；root 不在索引里返回 undefined。
 * idx 不给时按 root 找
 */
export async function indexedTree(root: string, want: RegExp, idx?: PluginFileIndex): Promise<string[] | undefined> {
  const index = idx ?? (await dirFileIndex(root))
  if (!index || index.has(root) !== 'dir') return undefined
  const r = await index.list(root, { recursive: true }).catch(() => undefined)
  if (!r) return undefined
  const pre = `${slash(root)}/`
  const ci = process.platform === 'win32'
  const preCmp = ci ? pre.toLowerCase() : pre
  const out: string[] = []
  for (const f of r.files) {
    const abs = slash(f)
    if (!(ci ? abs.toLowerCase() : abs).startsWith(preCmp)) continue
    const rel = abs.slice(pre.length)
    if (want.test(rel)) out.push(rel)
  }
  return out
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
  const index = await dirFileIndex(root)
  if (!index || index.has(root) !== 'dir') return undefined
  const r = await index.list(root, { recursive: true }).catch(() => undefined)
  if (!r) return undefined
  const pre = `${slash(root)}/`
  return r.dirs.map((d) => slash(d)).filter((d) => d.toLowerCase().startsWith(pre.toLowerCase())).map((d) => d.slice(pre.length))
}
