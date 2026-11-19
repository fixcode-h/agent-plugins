import type { HookInput, HookOutput } from '../../../sdk/server.ts'
import { liveCards } from '../instances.ts'
import { runOp, type OpCtx } from '../ops.ts'
import { getProject } from '../registry.ts'
import { compiledOk, noteCompile, takeSaved } from './state.ts'

/**
 * 写后编译（清单 hooks 的 compile-after-save，面板插件接口 3 的工具后钩子）：Agent 用 ue_save 把资源写到磁盘后，
 * 编译刚保存的蓝图，没通过的把错误和节点 id 补给模型，让它这一轮就接着修，不等到收尾或用户打开编辑器才发现。
 * 「写入」只认 ue_save：蓝图的其他改动都还在编辑器内存里，ue_blueprint edit 自己会编译；ue_python 存了什么插件看不到，
 * 那种情况靠测试步骤「蓝图编译」兜底（bin/bp-compile.mjs）。
 * 这个对话里已经编译通过、之后没再改过的不再编；编辑器没开（没有可用的进程）就什么都不做，不为编译起后台编辑器
 */

export const HOOK_ID = 'compile-after-save'

/** 一次最多编这么多个：一次保存几十上百个包时只编前面的，其余在提示里说明 */
const MAX_COMPILE = 20
/** 桥接对非蓝图资源的报错（AgentPanelEditorShared.cpp 的 LoadBlueprint：「X 不是蓝图（是 Y）」） */
const NOT_BP = /不是蓝图/
/** 补给模型的说明最长这么多字 */
const CONTEXT_MAX = 2400

interface CompileReport {
  status?: string
  errors?: number
  warnings?: number
  messages?: { severity?: string; text?: string }[]
  nodes?: { graph?: string; node?: string; title?: string; severity?: string; text?: string }[]
}

/** 各家 CLI 给 MCP 工具名加的前缀不一样（mcp__ue__ue_save、ue.ue_save……）：取最后一段 */
export function ueToolName(name: string) {
  const last = name.split(/__|[.:/]/).pop() ?? ''
  return /^ue_[a-z0-9_]+$/.test(last) ? last : ''
}

/** 一个蓝图的错误：节点上的带图名和节点 id，Agent 按 id 用 ue_blueprint edit 修 */
function errorLines(pkg: string, r: CompileReport) {
  const lines = [`- ${pkg}：${r.errors ?? 0} 个错误${r.warnings ? `、${r.warnings} 个警告` : ''}`]
  const nodes = (r.nodes ?? []).filter((n) => n.severity === 'error').slice(0, 6)
  for (const n of nodes) lines.push(`  - ${n.graph ?? ''} 节点 ${n.node ?? ''}（${n.title ?? ''}）：${n.text ?? ''}`)
  if (!nodes.length)
    for (const m of (r.messages ?? []).filter((x) => x.severity === 'error').slice(0, 4)) lines.push(`  - ${m.text}`)
  return lines
}

export async function compileAfterSave(input: HookInput): Promise<HookOutput | undefined> {
  if (input.event !== 'tool.after' || !input.tool || ueToolName(input.tool.name) !== 'ue_save') return undefined
  const taskId = input.task.id
  const savedNow = takeSaved(taskId)
  if (!savedNow || input.tool.result?.failed) return undefined
  const todo = savedNow.packages.filter((p) => !compiledOk(taskId, p))
  if (!todo.length) return undefined
  const project = await getProject(savedNow.projectId)
  if (!project || project.perms.asset === 'read') return undefined
  // 刚保存完编辑器（或后台编辑器）一定在：不在说明已经关了，不为了编译再起一个
  if (!(await liveCards(project.root)).length) return undefined
  const ctx: OpCtx = { project, actor: { kind: 'agent', taskId, agent: input.agent.name } }

  const failed: string[] = []
  const dirtied = new Set<string>()
  let passed = 0
  for (const pkg of todo.slice(0, MAX_COMPILE)) {
    let res: Record<string, unknown>
    try {
      res = await runOp(ctx, 'bp.compile', { path: pkg }, 120000)
    } catch (e) {
      const msg = (e as Error).message
      // 不是蓝图（DataTable、关卡……）不归编译管，跳过；别的原因（连不上、被别的对话占着）原样告诉模型
      if (!NOT_BP.test(msg)) failed.push(`- ${pkg}：没编成（${msg.slice(0, 200)}）`)
      continue
    }
    const r = (res.compile ?? {}) as CompileReport
    const ok = r.status === 'ok' || r.status === 'warnings'
    noteCompile(taskId, pkg, ok)
    for (const d of (res.dirtied as string[] | undefined) ?? []) dirtied.add(d)
    if (ok) passed++
    else failed.push(...errorLines(pkg, r))
  }
  const skipped = todo.length - Math.min(todo.length, MAX_COMPILE)
  if (!failed.length && !passed) return undefined

  const more = skipped ? `\n还有 ${skipped} 个刚保存的包没自动编译，要确认就逐个 ue_compile。` : ''
  const redirty = dirtied.size ? `\n编译后这些包又变成了没保存：${[...dirtied].join('、')}，确认没问题再 ue_save。` : ''
  if (!failed.length)
    return { context: `【UE】刚保存的 ${passed} 个蓝图已自动编译，都通过了。${more}${redirty}`.slice(0, CONTEXT_MAX) }
  const text = [
    `【UE】刚保存的蓝图有没编译通过的（已经写到磁盘上了）：`,
    ...failed,
    `按节点 id 用 ue_blueprint edit 修，ue_compile 确认通过后再 ue_save；修不了就如实告诉用户，或者 ue_undo / revert 撤回。`,
  ].join('\n')
  return { context: (text + more + redirty).slice(0, CONTEXT_MAX) }
}
