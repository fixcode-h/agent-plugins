import { noteCompile, packageName } from '../../bp-check/state.ts'
import type { OpCtx } from '../../ops.ts'
import { registerBatch } from '../registry.ts'
import type { ReportStep } from '../undo.ts'

/** 蓝图的批量：读大纲、读图、改、编译 */

const taskOf = (ctx: OpCtx) => (ctx.actor.kind === 'agent' ? ctx.actor.taskId : '')

/** 每个蓝图的编译结论交给写后编译钩子（bp-check/state.ts）：通过的保存后不再编 */
function noteCompiles(ctx: OpCtx, steps: ReportStep[]) {
  const task = taskOf(ctx)
  if (!task) return
  for (const s of steps) {
    const status = (s.result?.compile as { status?: string } | undefined)?.status
    if (s.phase === 'dryRun' || s.phase === 'undo' || s.state !== 'ok') continue
    // bp.edit compile=false（compile:"end" 的改动那一步）：改过、还没编，等后面 compile 那一步的结论
    if (!status) {
      if (s.phase === 'apply') noteCompile(task, packageName(s.args?.path), undefined)
      continue
    }
    noteCompile(task, packageName(s.args?.path), status === 'ok' || status === 'warnings')
  }
}

registerBatch('ue_blueprint.outline', { op: 'bp.outline', args: () => ({}), timeoutMs: 600000 })

registerBatch('ue_blueprint.graph', {
  op: 'bp.graph',
  args: (a) => ({
    graph: a.graph ?? '',
    format: a.format ?? 'pseudo',
    around: a.around ?? '',
    hops: a.hops,
    offset: a.offset,
    limit: a.limit,
  }),
  timeoutMs: 600000,
})

registerBatch('ue_blueprint.edit', {
  op: 'bp.edit',
  args: (a) => ({ ops: a.ops, compile: a.compile === 'end' ? 'end' : a.compile !== false, dryRun: !!a.dryRun }),
  timeoutMs: 1800000,
  write: true,
  after: noteCompiles,
})

registerBatch('ue_compile', { op: 'bp.compile', args: () => ({}), timeoutMs: 1800000, after: noteCompiles })
