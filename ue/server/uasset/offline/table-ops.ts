import { shortName } from '../../../shared/uasset/asset.ts'
import { prop } from '../../../shared/uasset/objects.ts'
import { rowsOf } from '../../../shared/uasset/snap.ts'
import { BridgeError } from '../../instances.ts'
import { t } from '../../util.ts'
import { objectOf } from './asset-ops.ts'
import { registerOffline } from './registry.ts'
import { clean, num } from './shape.ts'
import { fillRow, normRow } from '../../../shared/uasset/table-defaults.ts'
import { isStale, nativeDefaults, wantNative } from '../defaults/native-cache.ts'
import type { UeProject } from '../../types.ts'

/**
 * 数据表（照 UELink 的 datatable / datatable.row）。文件里每行只存了和行结构默认值不同的列：
 * 编辑器开着时记下过这个行结构各列的默认值（defaults/prime.ts）就补全每一行，列的顺序和类型照编辑器；
 * 没记过时列是「所有行里出现过的列」，没写的格子空着，并记进待补，下次编辑器开着时补上。
 */

async function tableOf(project: UeProject, path: string) {
  const { o } = await objectOf(project, path)
  const raw = rowsOf(o)
  if (!raw) throw new BridgeError(t('这不是 DataTable'))
  const rows = raw.map(normRow)
  const struct = String(prop(o, 'RowStruct') ?? '')
  const tablePath = o.path
  const e = struct ? await nativeDefaults(project.id, struct) : undefined
  const cols = e?.columns
  // 有行没写的列、记下的又不知道它的默认值（编辑器读那次每行都改过它）：表改过了，再补一次
  const gap = !!cols?.some((c) => !c.has && rows.some((r) => !(c.name in r)))
  if (struct && (!cols || gap || isStale(e!))) await wantNative(project.id, `${struct}@${tablePath}`, !!cols)
  return { o, rows: cols ? rows.map((r) => fillRow(r, cols)) : rows, cols, gap }
}

const fullNote = (cols: unknown, gap: boolean) =>
  cols && !gap
    ? t('没写的格子用的是上次编辑器开着时记下的行结构默认值')
    : t(
        '文件里每行只存了改过的列，没写的格子是行结构的默认值：编辑器开着时面板会自动记下默认值，以后编辑器没开也能看全',
      )

const isComplex = (v: unknown) => !!v && typeof v === 'object'

registerOffline('datatable', async ({ project, args }) => {
  const { o, rows, cols: known, gap } = await tableOf(project, String(args.path ?? ''))
  const cols = new Map<string, boolean>()
  // 记下的列先排（编辑器里的顺序），文件里多出来的接在后面
  for (const c of known ?? []) cols.set(c.name, isComplex(c.value) || /^(TArray|TMap|TSet|F[A-Z])/.test(c.type))
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
    columns: [...cols].map(([name, complex]) => ({
      name,
      type: known?.find((c) => c.name === name)?.type ?? '',
      complex,
    })),
    rows: hit.slice(offset, offset + limit).map((r) => {
      const { Name, ...values } = r
      return { name: String(Name), values: clean(values) }
    }),
    total: hit.length,
    dirty: false,
    note: fullNote(known, gap),
  }
})

registerOffline('datatable.row', async ({ project, args }) => {
  const { o, rows, cols, gap } = await tableOf(project, String(args.path ?? ''))
  const want = String(args.row ?? '')
  const row = rows.find((r) => String(r.Name) === want)
  if (!row) throw new BridgeError(t('{t} 里没有行 {r}', { t: o.name, r: want }))
  const filter = String(args.filter ?? '').toLowerCase()
  const why = t('编辑器没开，这是从文件读的：要改先打开编辑器')
  return {
    props: Object.entries(row)
      .filter(([k]) => k !== 'Name' && (!filter || k.toLowerCase().startsWith(filter)))
      .map(([name, value]) => ({
        name,
        type: cols?.find((c) => c.name === name)?.type ?? '',
        edit: true,
        readOnly: true,
        readOnlyWhy: why,
        value: clean(value),
      })),
    note: fullNote(cols, gap),
  }
})
