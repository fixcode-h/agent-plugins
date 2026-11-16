import { closeBackground } from '../editor.ts'
import type { UeProject } from '../types.ts'

/**
 * 经 VS 编译、启动 / 重启 UE（ue_vs_debug 和 UE 页的 VS 调试卡片共用）：先关后台编辑器，同时只开一个编辑器（用户 2026-11-16）。
 * 后台编辑器占着项目模块的 DLL，不关的话 F5 前那次编译链接也会写不进去
 */
export async function beforeVsLaunch(p: UeProject, op: string) {
  if (op === 'start' || op === 'restart' || op === 'build') await closeBackground(p, `vs ${op}`)
}
