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

// DataTable 改单元格：items 每项 {path, row, column, value}，同一张表可以出现多次；一张表里同一列改多行不用批量，直接 row 给数组 / where
registerBatch('ue_asset.set', {
  op: 'datatable.set',
  args: (a) => ({
    ...(a.row !== undefined ? { row: a.row } : {}),
    ...(a.column !== undefined ? { column: a.column } : {}),
    ...(a.value !== undefined ? { value: a.value } : {}),
    ...(a.where ? { where: a.where } : {}),
  }),
  timeoutMs: 600000,
  write: true,
})

registerBatch('ue_asset.reimport', {
  op: 'asset.reimport',
  args: (a) => ({ dryRun: !!a.dryRun }),
  timeoutMs: 1800000,
  write: true,
})

for (const action of ['duplicate', 'rename', 'delete'])
  registerBatch(`ue_asset.${action}`, {
    op: `asset.${action}`,
    args: (a) => ({ dryRun: !!a.dryRun, ...(action === 'delete' ? { force: !!a.force } : {}) }),
    timeoutMs: 1800000,
    write: true,
  })
