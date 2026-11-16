import type { ProjectState } from '../../../server/types.ts'
import type { ExtensionStatus } from '../../../server/uekit/catalog.ts'
import { canUpgrade } from '../../../server/semver.ts'
import { pget, useLoad } from '../../api.ts'

/**
 * UEKit 扩展的安装和可升级情况（UE 插件页同一个接口，服务端缓存了插件库目录）：左栏「UE 插件 · N 可升级」和概览的扩展卡片用。
 * 只在换项目时取一次，不定时刷：装卸、升级都在 UE 插件页做，那边自己会刷新
 */
export function useExtStatus(projectId: string | undefined) {
  return useLoad(
    () =>
      projectId
        ? pget<{ items: ExtensionStatus[]; error?: string }>(projectId, 'ext')
        : Promise.resolve(undefined),
    [projectId],
    0,
    `${projectId}/ext-status`,
  )
}

export interface Upgrade {
  name: string
  from: string
  to: string
}

/** 能升级的：UELink 看包里带的版本（state.bundled），扩展看插件库目录给的那一版 */
export function upgradesOf(state: ProjectState | undefined, exts: ExtensionStatus[] | undefined): Upgrade[] {
  const out: Upgrade[] = []
  if (state?.bridge && state.bundled && canUpgrade(state.bridge, state.bundled))
    out.push({ name: 'UELink', from: state.bridge, to: state.bundled })
  for (const x of exts ?? [])
    if (x.name !== 'UELink' && x.installed && x.offer && canUpgrade(x.installed.version, x.offer.version))
      out.push({ name: x.name, from: x.installed.version, to: x.offer.version })
  return out
}
