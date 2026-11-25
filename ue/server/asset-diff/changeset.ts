import { BridgeError } from '../instances.ts'
import type { UeProject } from '../types.ts'
import { searchIndex } from '../search-index/index.ts'
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

/** 等索引最多这么久：跳转弹窗一般早建好了，第一次建（扫磁盘）太慢就不等，网页按名字前缀猜类 */
const INDEX_WAIT_MS = 3000

/**
 * 包路径 → 类：用跳转弹窗的本地索引（UEToVS 的索引文件或面板扫的磁盘，见 search-index），只查这次提交里的资源。
 * 提交里删掉的资源索引里没有，留空
 */
async function classesOf(project: UeProject, assets: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!assets.length) return out
  const idx = await Promise.race([
    searchIndex(project).catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), INDEX_WAIT_MS).unref?.()),
  ])
  if (!idx) return out
  const want = new Set(assets)
  for (const [obj, cls] of idx.assets) {
    const pkg = obj.split('.')[0]
    if (cls && want.has(pkg)) out[pkg] = cls
  }
  return out
}

/**
 * truncated：面板一次最多列 CHANGED_FILES_MAX 个文件（旧面板 500 个、没导出这个数），列满了就当被截断，界面提示「只列了前 N 个」
 */
export async function changeSet(
  project: UeProject,
  change: string,
): Promise<{ assets: string[]; others: number; classes?: Record<string, string>; truncated?: number }> {
  if (!change) throw new BridgeError(t('缺少提交号'))
  const vh = (await import('@panel/server/exec/vcs-history')) as Record<string, unknown>
  // 旧面板没有 changedFiles：不报错，只是不列
  const fn = vh.changedFiles as ((dir: string, change: string) => Promise<string[]>) | undefined
  if (typeof fn !== 'function') return { assets: [], others: 0 }
  const files = await fn(project.root, change)
  const assets = [...new Set(files.map(packageOfRel).filter(Boolean))]
  const max = typeof vh.CHANGED_FILES_MAX === 'number' ? vh.CHANGED_FILES_MAX : 500
  const truncated = files.length >= max ? max : undefined
  return { assets, others: files.length - assets.length, classes: await classesOf(project, assets), truncated }
}
