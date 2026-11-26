import type { ChildProcess } from 'node:child_process'

/**
 * 起项目工具的入口：面板的 server/custom-tools/host（插件接口 4 起的开放模块，ADR 0082）。
 * 单测里没有面板的项目数据，setToolLauncher 换成一个直接起 shell 的假实现
 */
export interface ToolBrief {
  id: string
  name: string
  summary: string
  version: number
  params: { name: string; label: string; type: string; required: boolean; desc: string }[]
  errorPattern?: string
  okExit: number[]
}

export interface ToolLauncher {
  list(projectId: string): Promise<{ tools: ToolBrief[]; broken: { file: string; error: string }[]; dir?: string }>
  spawn(
    projectId: string,
    id: string,
    args: Record<string, unknown>,
    o: { source: string; title: string; detached?: boolean },
  ): Promise<{ tool: ToolBrief; line: string; cwd: string; checkout: string; child: ChildProcess }>
  noteRun(projectId: string, id: string, r: { ok: boolean; ms: number; summary?: string }): void
}

let override: ToolLauncher | undefined // 模块状态：只有单测会换

export function setToolLauncher(l: ToolLauncher | undefined) {
  override = l
}

export async function toolLauncher(): Promise<ToolLauncher> {
  if (override) return override
  const m = await import('@panel/server/custom-tools/host')
  return { list: m.projectTools, spawn: m.spawnProjectTool, noteRun: m.noteProjectToolRun }
}
