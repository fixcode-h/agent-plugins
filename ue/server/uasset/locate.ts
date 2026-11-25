import { existsSync } from 'node:fs'
import path from 'node:path'
import { BridgeError } from '../instances.ts'
import { projectMounts } from '../search-index/mounts.ts'
import { t } from '../util.ts'

/**
 * 包路径 → 磁盘上的资源文件：挂载点（项目 Content、能放内容的项目插件）统一走 search-index/mounts.ts，
 * 不再各处自己扫 Plugins。关卡是 .umap，其余 .uasset；两个都没有时给 .uasset 的路径（调用方按「这一版里没有」处理）。
 */
export async function assetFile(root: string, pkg: string): Promise<string> {
  const p = String(pkg).split('.')[0].split(':')[0]
  if (!p.startsWith('/')) throw new BridgeError(t('{p} 不是资源路径', { p: pkg }))
  const lower = p.toLowerCase()
  for (const m of await projectMounts(root)) {
    if (!lower.startsWith(m.mount.toLowerCase() + '/')) continue
    const base = path.join(m.dir, ...p.slice(m.mount.length + 1).split('/'))
    if (!existsSync(`${base}.uasset`) && existsSync(`${base}.umap`)) return `${base}.umap`
    return `${base}.uasset`
  }
  throw new BridgeError(t('找不到 {p} 在磁盘上的文件', { p: pkg }))
}
