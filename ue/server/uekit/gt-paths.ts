import path from 'node:path'
import { t } from '../util.ts'
import { hintDocsRoot } from './docs-sub.ts'

/**
 * GameTest 场景、AssetForge 配置这类项目文档的路径核对（从 gt-files.ts 分出来）：不 import 桥接（instances.ts），
 * 「AI 整理」的单测不用面板就能跑。出错抛普通 Error，接口层照样原样显示给网页。
 */

/**
 * 只认项目目录、项目外层同级的 ProjectDoc 和面板给的项目文档根（docs-sub.ts，P4 / SVN 各分支共用的那份可能在别的分支目录下）
 * 里的文件：AssetForge 配置、GameTest 场景跟着文档根走。相对路径按项目根算（gt 报告里的 path 就是这样）
 */
export function insideProject(root: string, rel: string) {
  const abs = path.resolve(root, rel)
  const hint = hintDocsRoot(root)
  if (!within(root, abs) && !within(path.join(path.dirname(root), 'ProjectDoc'), abs) && !(hint && within(hint, abs)))
    throw new Error(t('只能读项目目录和 ProjectDoc 里的文件：{p}', { p: rel }))
  return abs
}

export const within = (dir: string, abs: string) => {
  const r = path.relative(dir, abs)
  return !!r && !r.startsWith('..') && !path.isAbsolute(r)
}

/**
 * 场景根（gt.scenarios 的 absoluteRootDir）下的一个 .json 场景：出了场景根、不是 .json 都拒绝。
 * dir：在文件夹中显示时也认场景根本身和里面的子目录
 */
export function scenarioFile(projectRoot: string, scenarioRoot: string, rel: string, dir = false) {
  if (!scenarioRoot) throw new Error(t('不知道场景根在哪：先刷新 GameTest 页'))
  const rootAbs = insideProject(projectRoot, scenarioRoot)
  const abs = path.resolve(rootAbs, rel)
  const ok = dir ? abs === rootAbs || within(rootAbs, abs) : within(rootAbs, abs) && /\.json$/i.test(abs)
  if (!ok) throw new Error(t('只能操作场景根里的 .json 场景：{p}', { p: rel }))
  return { rootAbs, abs, rel: path.relative(rootAbs, abs).replace(/\\/g, '/') }
}
