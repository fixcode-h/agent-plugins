import { registerBatch } from '../registry.ts'

/** 蓝图的批量：读大纲、读图、改、编译 */

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
})

registerBatch('ue_compile', { op: 'bp.compile', args: () => ({}), timeoutMs: 1800000 })
