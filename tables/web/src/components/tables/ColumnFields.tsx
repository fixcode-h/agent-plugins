import { t } from '@shared/i18n'
import type { TableSchema } from '@shared/tables'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, Input, Select } from '@/components/ui/input'
import { ColumnRules } from './ColumnRules'
import { NEW_ENUM, type ColDraft } from './column-draft'

/** 参数类型的常用写法（下拉里的选项；也能手填别的） */
const TYPES = ['int32', 'uint32', 'int64', 'float', 'double', 'bool', 'string']
const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))

/**
 * 一列的结构的各项：参数类型、枚举、引用、范围、也允许的值、数组和分隔符、校验规则、说明。
 * 表格页的「列结构」和新建表格里每一列的列结构共用；存的时候用 column-draft 的 putColumn
 */
export function ColumnFields({
  x,
  onChange,
  schema,
  files,
  fields,
  typeHint,
  enumHint,
  listHint = false,
  noType,
}: {
  x: ColDraft
  onChange: (x: ColDraft) => void
  schema: TableSchema
  /** 引用时能选的表格文件 */
  files: string[]
  /** 这张表的其它字段名（条件必填选列用） */
  fields: string[]
  /** 表头类型行的字：参数类型、新建枚举的占位 */
  typeHint?: string
  /** 按类型名认出的枚举 */
  enumHint?: string
  /** 按表头认出是不是数组 */
  listHint?: boolean
  /** 新建表格时类型已经在表头类型行里填了，不再给参数类型 */
  noType?: boolean
}) {
  const d = x.d
  const put = (p: Partial<ColDraft>) => onChange({ ...x, ...p })
  const setD = (v: ColDraft['d']) => put({ d: v })
  return (
    <>
      {!noType && (
        <Field
          label={t('参数类型')}
          tip={t('表头类型行写错或没写时，按这里的类型检查和编辑；只记在结构文件里，表格不改')}
        >
          <Input
            size="sm"
            list="table-col-types"
            placeholder={typeHint || 'uint32'}
            value={d.type ?? ''}
            onChange={(e) => setD({ ...d, type: e.target.value })}
            className="tb:font-mono"
          />
          <datalist id="table-col-types">
            {[...TYPES, ...Object.keys(schema.enums)].map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
      )}
      <Field label={t('枚举')} tip={t('选了枚举后，这一列改格子时是下拉选择，填了不在枚举里的值会标红')}>
        <Select
          size="sm"
          value={d.enum ?? ''}
          onChange={(e) => setD({ ...d, enum: e.target.value || undefined })}
          options={[
            {
              value: '',
              label: enumHint && !d.enum ? t('按类型名：{e}', { e: enumHint }) : t('不是枚举'),
            },
            ...Object.keys(schema.enums).map((e) => ({ value: e, label: e })),
            { value: NEW_ENUM, label: t('新建枚举…') },
          ]}
        />
      </Field>
      {d.enum === NEW_ENUM && (
        <Input
          size="sm"
          autoFocus
          placeholder={typeHint || 'MyEnum'}
          value={x.newEnum}
          onChange={(e) => put({ newEnum: e.target.value })}
        />
      )}
      <Field
        label={t('引用')}
        tip={t('这一列填的是别的表的主键，写成「文件#字段」，例如 Config/Item.xlsx#ID；改格子时从那张表里选')}
      >
        <Input
          size="sm"
          list="table-ref-files"
          placeholder="Config/Item.xlsx#ID"
          value={d.ref ?? ''}
          onChange={(e) => setD({ ...d, ref: e.target.value })}
          className="tb:font-mono"
        />
        <datalist id="table-ref-files">
          {files.map((f) => (
            <option key={f} value={`${f}#ID`} />
          ))}
        </datalist>
      </Field>
      <div className="tb:grid tb:grid-cols-2 tb:gap-2">
        <Field label={t('最小值')}>
          <Input
            size="sm"
            type="number"
            value={d.min ?? ''}
            onChange={(e) => setD({ ...d, min: num(e.target.value) })}
          />
        </Field>
        <Field label={t('最大值')}>
          <Input
            size="sm"
            type="number"
            value={d.max ?? ''}
            onChange={(e) => setD({ ...d, max: num(e.target.value) })}
          />
        </Field>
      </div>
      <Field label={t('也允许的值')} tip={t('不在范围、枚举里也算对的特殊值，逗号分隔，例如 -1 表示未配置')}>
        <Input
          size="sm"
          placeholder="-1"
          value={x.allow}
          onChange={(e) => put({ allow: e.target.value })}
          className="tb:font-mono"
        />
      </Field>
      <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-3">
        <Checkbox
          checked={d.list ?? listHint}
          onChange={(v) => setD({ ...d, list: v })}
          label={t('数组（一格多个值）')}
        />
        {(d.list ?? listHint) && (
          <label className="tb:flex tb:items-center tb:gap-1.5 tb:text-footnote tb:text-muted">
            {t('分隔符')}
            <Input
              size="sm"
              aria-label={t('数组分隔符')}
              placeholder={schema.style.listSep || ';'}
              value={d.sep ?? ''}
              maxLength={4}
              onChange={(e) => setD({ ...d, sep: e.target.value || undefined })}
              className="tb:w-14 tb:text-center tb:font-mono"
            />
          </label>
        )}
      </div>
      <ColumnRules d={d} onChange={setD} fields={fields} when={x.when} onWhen={(when) => put({ when })} />
      <Field label={t('说明')}>
        <Input size="sm" value={d.note ?? ''} onChange={(e) => setD({ ...d, note: e.target.value })} />
      </Field>
    </>
  )
}
