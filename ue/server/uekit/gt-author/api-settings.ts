import path from 'node:path'
import type { UeProject } from '../../types.ts'
import { scenarioRoot } from '../gt-disk.ts'
import { API_FILE, readApiFile } from './api-file.ts'

/**
 * POST ext/gt/api：只剩 action=file（原样读场景根的 _api.json，编辑页的接口库弹窗编辑器没开时用）。
 * GameTest 2.9.0 起不再认项目测试接口（用户 2026-11-28：不许为测试专门写接口），设置页的「接口库」文件夹和 Lua 接口扫描都去掉了，
 * 测试里自己写的 Lua 放函数库（gt-luafn/）或 Lua 代码节点
 */
export async function apiSettingsAction(p: UeProject, b: Record<string, unknown>) {
  const scen = await scenarioRoot(p.root)
  if (b.action !== 'file')
    throw new Error(
      'GameTest 2.9.0 起不再扫项目测试接口：测试调实际的业务接口（执行 GM、对象调用），自己写的 Lua 放函数库',
    )
  const doc = await readApiFile(scen)
  return { path: path.join(scen, API_FILE).replace(/\\/g, '/'), exists: !!(doc.cpp || doc.lua), doc }
}
