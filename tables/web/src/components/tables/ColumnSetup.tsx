import { Fragment, useState } from 'react'
import { Columns3 } from 'lucide-react'
import { t } from '@shared/i18n'
import { colKey, type TableSchema } from '@shared/tables'
import type { ColInfo, ColKind } from '@shared/table-struct'
import { colName } from '@/lib/sheet'
import { cn } from '@/lib/utils'
import { roleShort } from '@/components/files/sheet-roles'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menu'
import { ColumnFields } from './ColumnFields'
import { NEW_ENUM, colDraftOf, putColumn, type ColDraft } from './column-draft'

export const kindLabel = (k: ColKind) =>
  ({
    int: t('整数'),
    uint: t('非负整数'),
    float: t('小数'),
    bool: t('布尔'),
    string: t('文字'),
    enum: t('枚举'),
    struct: t('结构'),
    other: t('未识别'),
  })[k]

/**
 * 「列结构」：当前列在表头里的每一行（修饰、导出端、类型、字段名、注释），手动改参数类型、指定枚举、引用、repeated、取值范围。
 * 按字段名记进项目的表格结构文件（每张表通用），表格文件不动
 */
export function ColumnSetup({
  info,
  file,
  schema,
  files,
  fields = [],
  onSchema,
}: {
  info: ColInfo | undefined
  /** 这张表的字段名（条件必填选列用） */
  fields?: string[]
  file: string
  schema: TableSchema
  /** 引用时能选的表格文件 */
  files: string[]
  onSchema: (s: TableSchema) => void
}) {
  const [open, setOpen] = useState(false)
  const key = info?.field ? colKey(file, '*', info.field) : ''
  const own = key ? schema.columns[key] : undefined
  const [x, setX] = useState<ColDraft>(() => colDraftOf())
  const reset = () => setX(colDraftOf(own))
  const save = () => {
    if (!key) return
    onSchema(putColumn(schema, key, x))
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) reset()
        setOpen(o)
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="sheet-tool tb:h-7" title={t('列结构')} disabled={!info}>
          <Columns3 className="tb:h-3.5 tb:w-3.5" />
          {t('列结构')}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="thin-scroll tb:max-h-[min(720px,calc(100dvh-120px))] tb:w-[360px] tb:overflow-y-auto tb:p-3"
        align="end"
      >
        {!info ? null : (
          <div className="tb:flex tb:flex-col tb:gap-3">
            <div className="tb:flex tb:items-baseline tb:gap-2">
              <span className="tb:shrink-0 tb:text-body tb:font-medium tb:whitespace-nowrap">
                {t('{col} 列', { col: colName(info.col) })}
              </span>
              <span className="tb:min-w-0 tb:truncate tb:font-mono tb:text-footnote tb:text-muted">
                {info.field || t('（没有字段名）')}
              </span>
              <span className="tb:ml-auto tb:shrink-0 tb:font-mono tb:text-caption tb:text-subtle">
                {info.type || '-'} · {kindLabel(info.kind)}
                {info.list ? ' · repeated' : ''}
              </span>
            </div>
            {info.head.length > 0 && (
              <dl className="tb:grid tb:grid-cols-[auto_1fr] tb:gap-x-3 tb:gap-y-1 tb:rounded-lg tb:bg-sel tb:px-2.5 tb:py-2 tb:text-caption">
                {info.head.map((h, i) => (
                  <Fragment key={i}>
                    <dt className="tb:flex tb:items-center tb:gap-1.5 tb:text-subtle">
                      <span className={cn('tb:h-2.5 tb:w-2.5 tb:rounded-[3px] sheet-role', `sheet-role-${h.role}`)} />
                      {roleShort(h.role)}
                    </dt>
                    <dd className="tb:min-w-0 tb:truncate tb:font-mono tb:text-fg" title={h.text}>
                      {h.text || '—'}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            )}
            {!info.field ? (
              <p className="tb:rounded-lg tb:bg-sel tb:px-2.5 tb:py-2 tb:text-caption tb:leading-relaxed tb:text-subtle">
                {t('这张表没有认出字段名行：先在「调整表头」里把字段名那一行标出来，列结构按字段名记。')}
              </p>
            ) : (
              <ColumnFields
                x={x}
                onChange={setX}
                schema={schema}
                files={files}
                fields={fields.filter((f) => f && f !== info.field)}
                typeHint={info.head.find((h) => h.role === 'type')?.text}
                enumHint={info.enumName}
                listHint={info.list}
              />
            )}
            <p className="tb:rounded-lg tb:bg-sel tb:px-2.5 tb:py-2 tb:text-caption tb:leading-relaxed tb:text-subtle">
              {t('按字段名记在项目的表格结构文件里（这个文件的每张表通用），表格文件不改。')}
            </p>
            <div className="tb:flex tb:justify-end tb:gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                {t('取消')}
              </Button>
              <Button size="sm" onClick={save} disabled={!info.field || (x.d.enum === NEW_ENUM && !x.newEnum.trim())}>
                {t('确定')}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
