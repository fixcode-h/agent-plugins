import type { Asset } from '../../shared/uasset/asset.ts'
import { readBlueprint, type Bp } from '../../shared/uasset/bp.ts'
import type { UeProject } from '../types.ts'
import { loadAsset } from './read.ts'

/**
 * 父蓝图链（离线读）：ParentClass 是磁盘上的蓝图（/Game/...、插件内容）就读它的文件，一直走到 C++ 类。
 * 组件列表要带上父蓝图加的组件（子蓝图没改过的在子蓝图文件里根本没有），和 UELink 的 components 一样标 inherited
 */
export interface BpLink {
  asset: Asset
  bp: Bp
}

export async function parentBlueprints(
  project: UeProject,
  bp: Bp,
  max = 8,
): Promise<{ chain: BpLink[]; unread: string[] }> {
  const chain: BpLink[] = []
  const unread: string[] = []
  const seen = new Set<string>()
  let parent = bp.parent
  while (parent && !parent.startsWith('/Script/') && chain.length < max) {
    const pkg = parent.split('.')[0]
    if (seen.has(pkg)) break
    seen.add(pkg)
    try {
      const asset = (await loadAsset(project, pkg)).asset
      const pb = readBlueprint(asset)
      if (!pb) break
      chain.push({ asset, bp: pb })
      parent = pb.parent
    } catch {
      unread.push(pkg)
      break
    }
  }
  return { chain, unread }
}
