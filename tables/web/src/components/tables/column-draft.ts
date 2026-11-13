import { TableColumn, type TableSchema } from '@shared/tables'

/** 枚举下拉里的「新建枚举…」 */
export const NEW_ENUM = '__new__'

/**
 * 列结构编辑中的样子：允许的值、条件必填的值是逗号分隔的原文，枚举可能是「新建」再填名字。
 * 表格页的「列结构」和新建表格里每一列的列结构共用（ColumnFields 画、putColumn 存）
 */
export interface ColDraft {
  d: TableColumn
  newEnum: string
  allow: string
  when: string
}

export const colDraftOf = (own?: TableColumn): ColDraft => ({
  d: own ?? {},
  newEnum: '',
  allow: (own?.allow ?? []).join(', '),
  when: (own?.requiredWhen?.values ?? []).join(', '),
})

const split = (s: string) =>
  s
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean)

/** 草稿理成要存的列结构；什么都没设返回 undefined。enumName 是要用的枚举名（可能是新建的） */
export function columnOf(x: ColDraft): { col?: TableColumn; enumName?: string } {
  const { d } = x
  const enumName = (d.enum === NEW_ENUM ? x.newEnum.trim() : d.enum) || undefined
  const col = TableColumn.parse({
    ...d,
    type: d.type?.trim() || undefined,
    enum: enumName,
    ref: d.ref?.trim() || undefined,
    allow: split(x.allow),
    note: d.note?.trim() || undefined,
    pattern: d.pattern?.trim() || undefined,
    requiredWhen:
      !d.required && d.requiredWhen?.field ? { field: d.requiredWhen.field, values: split(x.when) } : undefined,
  })
  if (!col.allow?.length) delete col.allow
  if (col.requiredWhen && !col.requiredWhen.values.length) delete col.requiredWhen
  const empty = Object.values(col).every((v) => v === undefined || v === false)
  return { col: empty ? undefined : col, enumName }
}

/** 把一列的结构写进结构文件（键是 colKey）：没设任何东西就删掉这一条；新建的枚举顺带建一个空的 */
export function putColumn(schema: TableSchema, key: string, x: ColDraft): TableSchema {
  const { col, enumName } = columnOf(x)
  const columns = { ...schema.columns }
  if (col) columns[key] = col
  else delete columns[key]
  const enums = enumName && !schema.enums[enumName] ? { ...schema.enums, [enumName]: { values: [] } } : schema.enums
  return { ...schema, columns, enums }
}
