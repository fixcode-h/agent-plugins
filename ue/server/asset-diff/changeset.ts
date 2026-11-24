import { BridgeError } from '../instances.ts'
import type { UeProject } from '../types.ts'
import { t } from '../util.ts'

/**
 * 「#1221205 里一起改的资源」（设计稿「UE资源版本差异-修复与强化」3.5）：点开某一版才查，不预先算。
 * 提交里的文件经面板 vcs-history 的 changedFiles 取（相对项目根），只留 .uasset / .umap，换成包路径：
 * Content/A/B.uasset → /Game/A/B；Plugins/…/<插件>/Content/A.uasset → /<插件>/A
 */
export function packageOfRel(rel: string): string {
  const p = rel.replaceAll('\\', '/')
  const m = /^(.*?)(?:^|\/)Content\/(.+)\.(uasset|umap)$/i.exec(p)
  if (!m) return ''
  const before = m[1]
  if (!before) return `/Game/${m[2]}`
  // 插件：Content 前面那一层目录名就是挂载点
  const plugin = before.split('/').filter(Boolean).pop()
  return /(^|\/)Plugins\//i.test(`${before}/`) && plugin ? `/${plugin}/${m[2]}` : ''
}

export async function changeSet(project: UeProject, change: string): Promise<{ assets: string[]; others: number }> {
  if (!change) throw new BridgeError(t('缺少提交号'))
  const vh = (await import('@panel/server/exec/vcs-history')) as Record<string, unknown>
  // 旧面板没有 changedFiles：不报错，只是不列
  const fn = vh.changedFiles as ((dir: string, change: string) => Promise<string[]>) | undefined
  if (typeof fn !== 'function') return { assets: [], others: 0 }
  const files = await fn(project.root, change)
  const assets = [...new Set(files.map(packageOfRel).filter(Boolean))]
  return { assets, others: files.length - assets.length }
}
