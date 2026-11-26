import type { McpResult } from '../../../sdk/server.ts'
import type { OpCtx } from '../ops.ts'
import { out, str } from '../toolkit.ts'
import type { LuaBuildRun } from '../types.ts'
import { mcpText } from '../util.ts'
import { startLuaBuild, waitBuild } from './run.ts'

/** Agent 一次最多等多久：长的编译先回编号，免得工具调用卡住对话 */
const WAIT_MS = 20000
/** 结果里列几条错误（完整的在输出文件里，ADR 0067 返回不超过 4000 字） */
const SHOW_ERRORS = 10

/**
 * ue_lua action=compile（设计稿四.3）：只跑 Lua 页「编译」里给两个按钮选好的项目工具；没编完回 job，带 job 再调接着等
 */
export async function luaCompileTool(a: Record<string, unknown>, ctx: OpCtx): Promise<McpResult> {
  let id = str(a.job)
  if (!id) {
    const mode = a.mode === 'full' ? 'full' : 'incremental'
    id = (await startLuaBuild(ctx, mode)).id
  }
  const r = await waitBuild(ctx.project.id, id, WAIT_MS)
  if (!r) return mcpText(`没有编号为 ${id} 的 Lua 编译（面板重启或之后又编过一次）：重新 action=compile`, true)
  return out(summary(r))
}

function summary(r: LuaBuildRun) {
  const base = {
    job: r.id,
    mode: r.mode,
    tool: r.tool?.id,
    status: r.status,
    files: r.mode === 'incremental' ? r.files.slice(0, 20) : undefined,
    fileCount: r.fileCount,
    logFile: r.logFile,
  }
  if (r.status === 'running')
    return { ...base, note: '还在编：带 job 再调一次 ue_lua action=compile 接着等', errorsSoFar: r.errors.length }
  return {
    ...base,
    exitCode: r.code,
    seconds: Math.round(((r.endedAt ?? r.startedAt) - r.startedAt) / 100) / 10,
    errorCount: r.errors.length,
    errors: r.errors.slice(0, SHOW_ERRORS).map((e) => `${e.file}:${e.line}${e.col ? `:${e.col}` : ''}: ${e.message}`),
    ...(r.errors.length > SHOW_ERRORS ? { more: `还有 ${r.errors.length - SHOW_ERRORS} 条，见 logFile` } : {}),
    ...(r.status === 'failed' && !r.errors.length
      ? {
          note: '失败了但输出里没认出 文件:行：读 logFile 看原文；认不出可能是项目工具的报错格式（output.errorPattern，命名分组 file、line、msg）和编译器输出对不上，可以用 custom_tool 改这个工具',
        }
      : {}),
    reload: r.reload,
  }
}
