import { useState } from 'react'
import { ListTree, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { t } from '@shared/i18n'
import { type TableSchema } from '@shared/tables'
import type { HeaderException, HeaderRule } from '@shared/table-header'
import { saveTableSchema, useSchemaDraft, useTableSchema } from '@/lib/table-schema'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { HeaderRowsEditor } from '@/components/tables/HeaderRowsEditor'
import { EnumsDialog } from '@/components/tables/EnumsDialog'
import { EnumRenameDialog } from '@/components/tables/EnumRenameDialog'
import { findEnumRenames, type EnumRename } from '@shared/table-enum-rename'

/** 没配置过时「用常见的 5 行表头」给的起点 */
const COMMON: HeaderRule = {
  start: 0,
  rows: [{ kind: 'modifier' }, { kind: 'side' }, { kind: 'type' }, { kind: 'name' }, { kind: 'comment' }],
}

interface Draft {
  header: HeaderRule
  /** 编辑中的原文（逗号分隔） */
  marks: string
  sep: string
  /** 按文件指定的表头（通配，可以细到工作表） */
  exceptions: HeaderException[]
}
const toDraft = (s: TableSchema): Draft => ({
  header: s.style.header,
  marks: (s.style.arrayMarks ?? []).join(', '),
  sep: s.style.listSep ?? ';',
  exceptions: s.style.exceptions ?? [],
})

/**
 * 项目设置 → 表格的「表头」：项目的表头是一个「行」的数组，一项对应表格表头的一行，可以加、删、挪，
 * 每行配名字、是什么、能填什么（选通用枚举）。表格页完全按这里显示，不按内容猜。
 * 存在表格结构文件（style.header），不在项目设置里，所以有自己的「保存」；AI 分析写进结构文件后这里跟着更新
 */
export function ProjectTablesHeader({ projectId }: { projectId: string }) {
  const { schema, error } = useTableSchema(projectId)
  const { draft: d, changed, setDraft, reset } = useSchemaDraft(schema, toDraft)
  const [busy, setBusy] = useState(false)
  if (error) return <p className="tb:text-footnote tb:text-danger">{error}</p>
  if (!schema || !d) return null
  const set = (p: Partial<Draft>) => setDraft((x) => ({ ...x, ...p }))
  const markList = d.marks
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  const enumNames = Object.keys(schema.enums).sort()
  const save = async () => {
    setBusy(true)
    try {
      const saved = await saveTableSchema(projectId, (cur) => ({
        ...cur,
        style: {
          ...cur.style,
          header: d.header,
          arrayMarks: markList,
          listSep: d.sep || ';',
          // 通配空着的留着等填（不生效）；连表头行都没有的才去掉
          exceptions: d.exceptions
            .map((e) => ({
              ...e,
              glob: e.glob.trim(),
              ...(e.sheet?.trim() ? { sheet: e.sheet.trim() } : { sheet: undefined }),
            }))
            .filter((e) => e.glob || e.header.rows.length),
        },
      }))
      reset(saved)
      toast.success(t('表头设置已保存'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="tb:flex tb:flex-col tb:gap-3">
      <div className="tb:rounded-(--c-card-radius) tb:border tb:px-3 tb:py-2.5">
        <div className="tb:mb-2 tb:flex tb:flex-wrap tb:items-center tb:gap-2">
          <span className="tb:text-footnote tb:font-medium">{t('项目的表头')}</span>
          <span className="tb:text-caption tb:text-subtle">
            {t('一项对应表格表头的一行，从上往下排；所有表都按这份显示，个别不一样的在下面按文件指定')}
          </span>
          {!d.header.rows.length && (
            <Button size="sm" variant="secondary" onClick={() => set({ header: COMMON })}>
              {t('用常见的 5 行表头')}
            </Button>
          )}
        </div>
        <HeaderRowsEditor value={d.header} onChange={(header) => set({ header })} enumNames={enumNames} />
      </div>
      <ExceptionList value={d.exceptions} enumNames={enumNames} onChange={(exceptions) => set({ exceptions })} />
      <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-x-4 tb:gap-y-2 tb:text-footnote tb:text-muted">
        <label className="tb:flex tb:items-center tb:gap-2">
          {t('修饰行里表示数组的值')}
          <Input
            size="sm"
            value={d.marks}
            placeholder="repeated"
            onChange={(e) => set({ marks: e.target.value })}
            className="tb:w-44 tb:font-mono"
          />
        </label>
        <label className="tb:flex tb:items-center tb:gap-2">
          {t('数组默认分隔符')}
          <Input
            size="sm"
            value={d.sep}
            maxLength={4}
            placeholder=";"
            onChange={(e) => set({ sep: e.target.value })}
            className="tb:w-14 tb:text-center tb:font-mono"
          />
        </label>
        <span className="tb:text-caption tb:text-subtle">
          {t('类型写成 int[]、list<int> 也算数组；单独的列在「列结构」里改')}
        </span>
      </div>
      <div className="tb:flex tb:items-center tb:gap-3">
        <Button size="sm" disabled={!changed || busy} onClick={() => void save()}>
          {t('保存表头')}
        </Button>
        <span className="tb:text-caption tb:text-subtle">
          {t('存在表格结构文件里，表格文件不动；还没配置时可以在「AI 分析」里让 AI 读现有的表总结出来。')}
        </span>
      </div>
    </div>
  )
}

/**
 * 按文件指定表头：和项目表头不一样的表按通配指定（AI 分析、表格页「调整表头」也写到这里），排在前面的优先。
 * 写了工作表名就只管那个工作表
 */
function ExceptionList({
  value,
  enumNames,
  onChange,
}: {
  value: HeaderException[]
  enumNames: string[]
  onChange: (v: HeaderException[]) => void
}) {
  const put = (i: number, e: HeaderException) => onChange(value.map((x, j) => (j === i ? e : x)))
  return (
    <div className="tb:flex tb:flex-col tb:gap-2">
      {value.map((e, i) => (
        <div key={i} className="tb:rounded-(--c-card-radius) tb:border tb:px-3 tb:py-2.5">
          <div className="tb:mb-2 tb:flex tb:flex-wrap tb:items-center tb:gap-2">
            <span className="tb:shrink-0 tb:text-footnote tb:font-medium">{t('这些文件')}</span>
            <Input
              size="sm"
              aria-label={t('第 {n} 条按文件指定的通配', { n: i + 1 })}
              value={e.glob}
              placeholder="Config/Enum/*.xlsx"
              onChange={(ev) => put(i, { ...e, glob: ev.target.value })}
              className="tb:min-w-40 tb:flex-1 tb:font-mono"
            />
            <Input
              size="sm"
              aria-label={t('第 {n} 条按文件指定的工作表', { n: i + 1 })}
              value={e.sheet ?? ''}
              placeholder={t('所有工作表')}
              onChange={(ev) => put(i, { ...e, sheet: ev.target.value || undefined })}
              className="tb:w-32"
            />
            <IconButton
              icon={Trash2}
              size="xs"
              tone="danger"
              label={t('删掉第 {n} 条按文件指定', { n: i + 1 })}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            />
          </div>
          {!e.glob.trim() && <p className="tb:mb-2 tb:text-caption tb:text-warning">{t('还没填通配，这条先不生效')}</p>}
          <HeaderRowsEditor value={e.header} enumNames={enumNames} onChange={(header) => put(i, { ...e, header })} />
        </div>
      ))}
      <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={value.length >= 100}
          onClick={() => onChange([...value, { glob: '', header: { start: 0, rows: [{ kind: 'name' }] } }])}
        >
          <Plus className="tb:h-3.5 tb:w-3.5" />
          {t('按文件指定表头')}
        </Button>
        <span className="tb:text-caption tb:text-subtle">
          {t('表头和项目不一样的表（比如某个目录的枚举表）按通配指定，排在前面的优先。')}
        </span>
      </div>
    </div>
  )
}

/**
 * 项目设置 → 表格的「通用枚举」：整个项目所有表格共用的枚举库（结构文件 enums.json）。
 * 任何一张表的列在「列结构」里选它，或类型行写了同名类型，就按它下拉、检查
 */
export function ProjectTablesEnums({ projectId }: { projectId: string }) {
  const { schema, error } = useTableSchema(projectId)
  const [open, setOpen] = useState(false)
  const [renames, setRenames] = useState<EnumRename[] | null>(null)
  if (error) return <p className="tb:text-footnote tb:text-danger">{error}</p>
  if (!schema) return null
  const names = Object.keys(schema.enums).sort()
  return (
    <div className="tb:flex tb:flex-col tb:gap-2">
      <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-1.5">
        {names.length ? (
          names.slice(0, 24).map((n) => (
            <span
              key={n}
              className="tb:inline-flex tb:h-6 tb:items-center tb:gap-1 tb:rounded-(--c-badge-radius) tb:bg-sel tb:px-2 tb:font-mono tb:text-caption tb:text-muted"
            >
              {n}
              <span className="tb:text-subtle">{schema.enums[n].values.length}</span>
            </span>
          ))
        ) : (
          <span className="tb:text-footnote tb:text-subtle">{t('还没有通用枚举')}</span>
        )}
        {names.length > 24 && (
          <span className="tb:text-caption tb:text-subtle">{t('等 {n} 个', { n: names.length })}</span>
        )}
      </div>
      <div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <ListTree className="tb:h-4 tb:w-4" />
          {t('管理通用枚举')}
        </Button>
      </div>
      {open && (
        <EnumsDialog
          open
          schema={schema}
          onOpenChange={setOpen}
          onSave={async (enums) => {
            try {
              await saveTableSchema(projectId, (cur) => ({ ...cur, enums }))
              toast.success(t('通用枚举已保存'))
              const r = findEnumRenames(schema.enums, enums)
              if (r.length) setRenames(r)
            } catch (e) {
              toast.error((e as Error).message)
            }
          }}
        />
      )}
      {renames && <EnumRenameDialog projectId={projectId} renames={renames} onClose={() => setRenames(null)} />}
    </div>
  )
}
