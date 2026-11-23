import { existsSync } from 'node:fs'
import path from 'node:path'
import { getProject } from './registry.ts'

/**
 * 项目外要一起收进索引的目录（面板插件接口 16 的 fileIndexRoots）：UE 引擎的 Engine 目录，
 * 找引擎头文件、引擎插件的资源也走索引。编译产物、缓存不收
 */
export async function ueIndexRoots(project: { id: string }) {
  const p = await getProject(project.id)
  const dir = p?.engineDir || p?.engine.dir
  if (!dir) return []
  const engine = path.join(dir, 'Engine')
  if (!existsSync(engine)) return []
  return [
    {
      root: engine,
      exclude: ['Binaries', 'Intermediate', 'DerivedDataCache', 'Saved', 'Documentation', 'Extras', '.git'],
    },
  ]
}
