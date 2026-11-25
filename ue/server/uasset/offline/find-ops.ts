import { existsSync } from 'node:fs'
import path from 'node:path'
import { projectMounts, toObjectPath } from '../../search-index/mounts.ts'
import { loadAsset } from '../read.ts'
import { registerOffline } from './registry.ts'

/**
 * 对话里点开 .uasset 的查看窗（web/AssetFile.tsx）按磁盘路径找资源：编辑器没开时直接认文件，
 * 不为了「这个文件是哪个资源」起后台编辑器。只认前缀是磁盘上存在的资源文件，按名字搜还是交给 UE
 */
const diskFile = (args: Record<string, unknown>) => {
  const p = String(args.prefix ?? '')
  return /\.(uasset|umap)$/i.test(p) && path.isAbsolute(p) && existsSync(p) ? p : ''
}

registerOffline(
  'assets',
  async ({ project, args }) => {
    const file = diskFile(args)
    const objectPath = toObjectPath(file, await projectMounts(project.root))
    if (!objectPath) return { items: [], total: 0 }
    const { asset } = await loadAsset(project, objectPath)
    const main = asset.main
    const pkg = objectPath.split('.')[0]
    return {
      items: [
        {
          path: main?.path ?? objectPath,
          name: main?.name ?? pkg.split('/').pop(),
          class: main?.class ?? '',
          package: pkg,
        },
      ],
      total: 1,
    }
  },
  (args) => !!diskFile(args),
)
