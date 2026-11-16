import { cmpVersion } from '../semver.ts'
import type { UeProject } from '../types.ts'

// 扩展该给哪一版：只依赖版本比较，单独成文件好在不起面板的情况下单测（catalog.ts 引了面板的下载模块）

/** "5.8" 这类引擎版本前两段比较：项目引擎读不出来时不拦 */
export function engineTooOld(project: UeProject, min?: string) {
  const v = project.engine?.version
  if (!min || !v) return false
  const two = (s: string) => s.split('.').slice(0, 2).join('.')
  return cmpVersion(two(v), two(min)) < 0
}

/**
 * 给用户装哪一版：有正式版装正式版，没有时用预发布版；已经装着预发布版的继续给更新的预发布版。
 * 正式版要的引擎比项目新、预发布版支持这个引擎时（例如 GameTest 正式版要 5.8、预发布已降到 5.4）给预发布版：
 * 否则用户只看到「要 UE 5.8」装不上，不知道已经有能用的版本
 */
export function pickOffer<Offerable extends { version: string; engineMin?: string }>(
  project: UeProject,
  e: { latest: Offerable | null; prerelease: Offerable | null },
  installed?: string,
) {
  const { latest, prerelease } = e
  if (latest && prerelease && installed && cmpVersion(installed, latest.version) > 0) return prerelease
  if (latest && prerelease && engineTooOld(project, latest.engineMin) && !engineTooOld(project, prerelease.engineMin))
    return prerelease
  return latest ?? prerelease ?? null
}
