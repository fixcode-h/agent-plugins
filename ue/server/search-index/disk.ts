import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { IndexAsset, IndexLua, Mounts } from './types.ts'

/**
 * 没有 UEToVS 的索引时面板自己扫磁盘建索引：只列文件名，不读 .uasset 内容（类名认不出，.umap 记 World）。
 * 增量：每个目录记下修改时间和直接子项，再扫时目录的修改时间没变就用记着的子项，只重读变了的目录
 * （增删改名都会改所在目录的修改时间；资源内容改了文件名不变，对索引没影响）。几千个目录一次 stat 很快，不用盯文件变化
 */

/** World Partition 一个 Actor 一个文件的目录：成千上万个哈希名，搜不到有用的东西（和 UEToVS 的 AssetLister 一致） */
const SKIP = new Set(['__externalactors__', '__externalobjects__'])
const ASSET = /\.(uasset|umap)$/i
const LUA = /\.lua$/i
/** 同时读的目录数：太多会把文件句柄占满 */
const PARALLEL = 32

interface DirNode {
  mtimeMs: number
  files: string[]
  dirs: string[]
}

export class DiskScanner {
  private dirs = new Map<string, DirNode>()
  /** 有目录重读过就加 1：网页按这个判断索引变没变 */
  generation = 0

  private readonly want: RegExp

  constructor(want: RegExp) {
    this.want = want
  }

  /** 扫这些根目录，回所有匹配的文件（根目录、相对路径）；根不存在就跳过 */
  async scan(roots: string[]) {
    const seen = new Set<string>()
    const out: { root: string; rel: string }[] = []
    let changed = false
    const queue: { root: string; dir: string }[] = roots.map((r) => ({ root: r, dir: r }))
    const work = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const st = await stat(job.dir).catch(() => undefined)
        if (!st?.isDirectory()) continue
        seen.add(job.dir)
        let node = this.dirs.get(job.dir)
        if (!node || node.mtimeMs !== st.mtimeMs) {
          const ents = await readdir(job.dir, { withFileTypes: true }).catch(() => [])
          node = {
            mtimeMs: st.mtimeMs,
            files: ents.filter((e) => e.isFile() && this.want.test(e.name)).map((e) => e.name),
            dirs: ents
              .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name.toLowerCase()))
              .map((e) => e.name),
          }
          this.dirs.set(job.dir, node)
          changed = true
        }
        const relDir = path.relative(job.root, job.dir)
        for (const f of node.files) out.push({ root: job.root, rel: relDir ? path.join(relDir, f) : f })
        for (const d of node.dirs) queue.push({ root: job.root, dir: path.join(job.dir, d) })
      }
    }
    // 队列是边扫边加的：一个工人发现队列空了就退出，所以每轮都补齐工人，直到真的没有活
    while (queue.length) await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, work))
    // 删掉的目录不再记着
    for (const d of this.dirs.keys())
      if (!seen.has(d)) {
        this.dirs.delete(d)
        changed = true
      }
    if (changed) this.generation++
    return out
  }
}

/** 扫资源：挂载点的 Content 目录 → 对象路径 */
export async function diskAssets(scanner: DiskScanner, mounts: Mounts): Promise<IndexAsset[]> {
  const byDir = new Map(mounts.map((m) => [m.dir, m.mount]))
  // 插件 Content 嵌在项目 Content 里很少见，真有就会出现两次：按对象路径去重
  const files = await scanner.scan(mounts.map((m) => m.dir))
  const out = new Map<string, IndexAsset>()
  for (const f of files) {
    const rel = f.rel.replace(/\\/g, '/').replace(ASSET, '')
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    const p = `${byDir.get(f.root)}/${rel}.${name}`
    out.set(p, [p, /\.umap$/i.test(f.rel) ? 'World' : ''])
  }
  return [...out.values()]
}

/** 扫 Lua：脚本目录下的 .lua，模块名 = 相对路径把 / 换成 .（UnLua 的 require 写法） */
export async function diskLua(scanner: DiskScanner, scriptDir: string): Promise<IndexLua[]> {
  const files = await scanner.scan([scriptDir])
  return files.map((f) => [f.rel.replace(/\\/g, '/').replace(LUA, '').replace(/\//g, '.'), path.join(f.root, f.rel)])
}

export const assetScanner = () => new DiskScanner(ASSET)
export const luaScanner = () => new DiskScanner(LUA)
