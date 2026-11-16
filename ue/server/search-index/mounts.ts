import path from 'node:path'
import { projectPlugins } from '../asset-folders-disk.ts'
import type { Mounts } from './types.ts'

/** 项目的挂载点（项目 Content + 能放内容的项目插件）；长的目录排前面，插件 Content 在项目里嵌套时先认插件 */
export async function projectMounts(root: string): Promise<Mounts> {
  const plugins = await projectPlugins(root)
  return [
    { mount: '/Game', dir: path.join(root, 'Content') },
    ...plugins.map((m) => ({ mount: `/${m.name}`, dir: m.dir })),
  ].sort((a, b) => b.dir.length - a.dir.length)
}

const norm = (s: string) => path.resolve(s).replace(/\\/g, '/')

/** 磁盘上的 .uasset / .umap → 对象路径 /Game/A/BP_X.BP_X；不在任何挂载点里返回空串 */
export function toObjectPath(file: string, mounts: Mounts) {
  const f = norm(file)
  const lower = f.toLowerCase()
  for (const m of mounts) {
    const d = norm(m.dir).toLowerCase() + '/'
    if (!lower.startsWith(d)) continue
    const rel = f.slice(d.length).replace(/\.(uasset|umap)$/i, '')
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    return `${m.mount}/${rel}.${name}`
  }
  return ''
}
