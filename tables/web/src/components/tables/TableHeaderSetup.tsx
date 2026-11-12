import { useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { t } from '@shared/i18n'
import type { SheetHeader } from '@shared/sheet-header'
import { schemaHeader, type HeaderSource, type TableSchema } from '@shared/tables'
import { fromSheetHeader, sameRule, toSheetHeader, type HeaderRule, type TableHeader } from '@shared/table-header'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menu'
import type { SheetHeaderStore } from '@/components/files/use-sheet-view'
import { HeaderRowsEditor, ruleText } from './HeaderRowsEditor'

/** 只管这一个工作表的「按文件指定」写进去（已有就换掉，没有就放最前面）；h 为空就删掉，改回按配置 */
function putSheetRule(schema: TableSchema, file: string, sheet: string, h: HeaderRule | null): TableSchema {
  const rest = schema.style.exceptions.filter((e) => !(e.glob === file && e.sheet === sheet))
  const exceptions = h ? [{ glob: file, sheet, header: h }, ...rest] : rest
  return { ...schema, style: { ...schema.style, exceptions } }
}

/**
 * 表格页一张表的表头：只按项目的表头配置（按文件指定 > 项目表头），不看内容。
 * store 交给面板的 useSheetView：own 是只管这个工作表的那条，style 是其余配置算出来的
 */
export function useTableHeader(
  schema: TableSchema,
  file: string,
  sheet: string,
  onSchema: (s: TableSchema) => void,
): { rule: HeaderRule; header: TableHeader; source: HeaderSource; store: SheetHeaderStore } {
  return useMemo(() => {
    const { rule, source } = schemaHeader(schema, file, sheet)
    const header = toSheetHeader(rule)
    const has = rule.rows.length > 0
    const store: SheetHeaderStore = {
      own: source.kind === 'sheet' && has ? header : undefined,
      style: source.kind !== 'sheet' && has ? header : undefined,
      // 旧版面板自带的「调整表头」只给 SheetHeader：换回配置时照留每行能填什么
      save: (h: SheetHeader | null) => onSchema(putSheetRule(schema, file, sheet, h && fromSheetHeader(h, rule))),
    }
    return { rule, header, source, store }
  }, [schema, file, sheet, onSchema])
}

/**
 * 表格页的「调整表头」：改的是项目的表头配置。可以只改这张表（存成只管这个工作表的「按文件指定」），
 * 也可以直接改它现在用的那份（项目表头或那条按文件指定），所有用这份的表一起变
 */
export function TableHeaderSetup({
  schema,
  file,
  sheet,
  rows,
  rule,
  source,
  onSchema,
  disabled,
}: {
  schema: TableSchema
  file: string
  sheet: string
  rows: string[][]
  rule: HeaderRule
  source: HeaderSource
  onSchema: (s: TableSchema) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<HeaderRule>(rule)
  const enumNames = useMemo(() => Object.keys(schema.enums).sort(), [schema.enums])
  const preview = (r: number) =>
    (rows[r] ?? [])
      .filter((c) => c)
      .slice(0, 3)
      .join(' · ')
  const changed = !sameRule(draft, rule)
  const done = (s: TableSchema) => {
    onSchema(s)
    setOpen(false)
  }
  /** 改它现在用的那份：项目表头或那条按文件指定 */
  const saveShared = () => {
    if (source.kind === 'project') return done({ ...schema, style: { ...schema.style, header: draft } })
    const exceptions = schema.style.exceptions.map((e, i) => (i === source.index ? { ...e, header: draft } : e))
    done({ ...schema, style: { ...schema.style, exceptions } })
  }
  const from =
    source.kind === 'project'
      ? t('用的是项目的表头')
      : source.kind === 'sheet'
        ? t('这张表单独设了表头')
        : t('用的是按文件指定的表头（{glob}）', { glob: schema.style.exceptions[source.index]?.glob ?? '' })
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(rule)
        setOpen(o)
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="sheet-tool tb:h-7" title={t('调整表头')} disabled={disabled}>
          <SlidersHorizontal className="tb:h-3.5 tb:w-3.5" />
          {t('调整表头')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="tb:w-[640px] tb:max-w-[calc(100vw-32px)] tb:p-3" align="end">
        <div className="tb:mb-1 tb:text-body tb:font-medium tb:text-fg">{t('表头设置')}</div>
        <p className="tb:mb-3 tb:text-caption tb:text-subtle">
          {from} · {ruleText(rule)}
        </p>
        <HeaderRowsEditor
          value={draft}
          onChange={setDraft}
          enumNames={enumNames}
          last={Math.max(1, rows.length)}
          preview={preview}
        />
        <p className="tb:mt-3 tb:rounded-lg tb:bg-sel tb:px-2.5 tb:py-2 tb:text-caption tb:leading-relaxed tb:text-subtle">
          {t('记在项目的表格结构文件里（项目设置 → 表格 → 表头），表格文件一个字节都不改。')}
        </p>
        <div className="tb:mt-3 tb:flex tb:flex-wrap tb:items-center tb:justify-end tb:gap-2">
          {source.kind === 'sheet' && (
            <Button size="sm" variant="ghost" onClick={() => done(putSheetRule(schema, file, sheet, null))}>
              {t('改回按项目设置')}
            </Button>
          )}
          <span className="tb:flex-1" />
          {source.kind !== 'sheet' && (
            <Button size="sm" variant="secondary" disabled={!changed} onClick={saveShared}>
              {source.kind === 'project' ? t('改项目的表头') : t('改这条按文件指定')}
            </Button>
          )}
          <Button size="sm" disabled={!changed} onClick={() => done(putSheetRule(schema, file, sheet, draft))}>
            {source.kind === 'sheet' ? t('确定') : t('只改这张表')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
