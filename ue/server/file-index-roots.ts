import { existsSync } from 'node:fs'
import path from 'node:path'
import { projectEngineDir } from './registry.ts'

/**
 * 项目外要一起收进索引的目录（面板插件接口 16 的 fileIndexRoots）：UE 引擎的 Engine 目录，
 * 找引擎头文件、引擎插件的资源也走索引。编译产物、缓存不收
 */
export async function ueIndexRoots(project: { id: string }) {
  // 只读引擎目录这一个字段：取整个项目要问文档根（P4 项目跑 p4），面板查索引时会卡住
  const dir = await projectEngineDir(project.id)
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
