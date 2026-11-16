/**
 * 表格设置（结构文件：表头、枚举、扫描规则、类型、列）的导出和导入（用户 2026-11-16：复制到剪贴板、从剪贴板导入、
 * 导出文件、从文件导入），用来在 P4 的别的分支、别的项目、别的同事之间搬一份设好的表格设置。
 * 只搬人写的设置：扫描出来的枚举成员不带（导入后按扫描规则重扫），分析时间也不带。
 */
import { t } from './i18n.ts'
import { upgradeSchemaRaw } from './table-schema-upgrade.ts'
import { TableSchema } from './tables.ts'

/** 导出内容的格式名：导入时认它，也认直接贴进来的一份结构（没有外层的） */
export const SCHEMA_FORMAT = 'agent-panel/tables-schema'

/** 写 enums.json 前、导出前去掉扫描结果；只靠扫描才有的枚举（没手写成员、没指向枚举表）整个不要 */
export function stripScanned(schema: TableSchema): TableSchema {
  const enums: TableSchema['enums'] = {}
  for (const [k, e] of Object.entries(schema.enums)) {
    const { scanned, ...rest } = e
    if (scanned && !rest.values.length && !rest.source) continue
    enums[k] = rest
  }
  return { ...schema, enums }
}

/** 导出成 JSON 文字（两格缩进，贴进聊天、存成文件都能看） */
export function exportSchemaText(schema: TableSchema) {
  const { analyzedAt: _, ...rest } = stripScanned(schema)
  return `${JSON.stringify({ format: SCHEMA_FORMAT, version: 1, schema: rest }, null, 2)}\n`
}

/** 导入：认导出的格式，也认直接一份结构；读不出来照实说哪里不对 */
export function parseSchemaText(text: string): { schema?: TableSchema; error?: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text.trim())
  } catch (e) {
    return { error: t('不是 JSON：{error}', { error: (e as Error).message }) }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: t('内容不是表格设置') }
  const o = raw as Record<string, unknown>
  const body = o.format === SCHEMA_FORMAT ? o.schema : raw
  if (!body || typeof body !== 'object') return { error: t('内容不是表格设置') }
  const known = ['style', 'enums', 'columns', 'types', 'scans']
  if (!known.some((k) => k in body)) return { error: t('内容不是表格设置') }
  const p = TableSchema.safeParse(upgradeSchemaRaw(body as Record<string, unknown>))
  if (!p.success)
    return {
      error: p.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    }
  return { schema: stripScanned(p.data) }
}

/** 一句话说一份设置里有什么：「表头 5 行，12 个枚举，2 条扫描规则，3 个类型，40 列」 */
export function schemaBrief(s: TableSchema) {
  return [
    s.style.header?.rows.length && t('表头 {n} 行', { n: s.style.header.rows.length }),
    Object.keys(s.enums).length && t('{n} 个枚举', { n: Object.keys(s.enums).length }),
    s.scans.length && t('{n} 条扫描规则', { n: s.scans.length }),
    Object.keys(s.types).length && t('{n} 个类型', { n: Object.keys(s.types).length }),
    Object.keys(s.columns).length && t('{n} 列', { n: Object.keys(s.columns).length }),
  ]
    .filter(Boolean)
    .join('，')
}
