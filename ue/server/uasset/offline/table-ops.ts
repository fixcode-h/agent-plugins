import { shortName } from '../../../shared/uasset/asset.ts'
import { prop } from '../../../shared/uasset/objects.ts'
import { rowsOf } from '../../../shared/uasset/snap.ts'
import { BridgeError } from '../../instances.ts'
import { t } from '../../util.ts'
import { objectOf } from './asset-ops.ts'
import { registerOffline } from './registry.ts'
import { clean, num } from './shape.ts'

/**
 * 数据表（照 UELink 的 datatable / datatable.row）。文件里每行只存了和行结构默认值不同的列，
 * 所以列是「所有行里出现过的列」，某行没写的列是默认值，表格里空着。
 */

async function tableOf(project: Parameters<typeof objectOf>[0], path: string) {
  const { o } = await objectOf(project, path)
  const rows = rowsOf(o)
  if (!rows) throw new BridgeError(t('这不是 DataTable'))
  return { o, rows }
}

const isComplex = (v: unknown) => !!v && typeof v === 'object'

registerOffline('datatable', async ({ project, args }) => {
  const { o, rows } = await tableOf(project, String(args.path ?? ''))
  const cols = new Map<string, boolean>()
  for (const r of rows)
    for (const [k, v] of Object.entries(r)) if (k !== 'Name') cols.set(k, (cols.get(k) ?? false) || isComplex(v))
  const filter = String(args.filter ?? '').toLowerCase()
  const hit = filter
    ? rows.filter(
        (r) => String(r.Name).toLowerCase().startsWith(filter) || JSON.stringify(r).toLowerCase().includes(filter),
      )
    : rows
  const offset = Math.max(0, num(args.offset, 0))
  const limit = Math.min(1000, Math.max(1, num(args.limit, 100)))
  return {
    struct: shortName(prop(o, 'RowStruct')),
    columns: [...cols].map(([name, complex]) => ({ name, type: '', complex })),
    rows: hit.slice(offset, offset + limit).map((r) => {
      const { Name, ...values } = r
      return { name: String(Name), values: clean(values) }
    }),
    total: hit.length,
    dirty: false,
    note: t('文件里每行只存了改过的列，没写的列是行结构的默认值'),
  }
})

registerOffline('datatable.row', async ({ project, args }) => {
  const { o, rows } = await tableOf(project, String(args.path ?? ''))
  const want = String(args.row ?? '')
  const row = rows.find((r) => String(r.Name) === want)
  if (!row) throw new BridgeError(t('{t} 里没有行 {r}', { t: o.name, r: want }))
  const filter = String(args.filter ?? '').toLowerCase()
  const why = t('编辑器没开，这是从文件读的：要改先打开编辑器')
  return {
    props: Object.entries(row)
      .filter(([k]) => k !== 'Name' && (!filter || k.toLowerCase().startsWith(filter)))
      .map(([name, value]) => ({ name, type: '', edit: true, readOnly: true, readOnlyWhy: why, value: clean(value) })),
  }
})
