import { registerBatch } from '../registry.ts'

/** 资源的批量：describe / refs / export 读，复制 / 改名 / 删除写（复制、改名每项的 to 不同，用 items） */

registerBatch('ue_asset.describe', { op: 'asset.describe', args: () => ({}), timeoutMs: 600000 })

registerBatch('ue_asset.refs', {
  op: 'asset.refs',
  args: (a) => ({ direction: a.direction ?? 'both', hard: !!a.hard, depth: a.depth, limit: a.limit }),
  timeoutMs: 600000,
})

// 批量导出一律写文件：几百份整份导出塞不进回包
registerBatch('ue_asset.export', {
  op: 'asset.export',
  args: (a) => ({ depth: a.depth, file: true }),
  timeoutMs: 600000,
})

for (const action of ['duplicate', 'rename', 'delete'])
  registerBatch(`ue_asset.${action}`, {
    op: `asset.${action}`,
    args: (a) => ({ dryRun: !!a.dryRun, ...(action === 'delete' ? { force: !!a.force } : {}) }),
    timeoutMs: 1800000,
    write: true,
  })
