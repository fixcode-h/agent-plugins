import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { t } from '@shared/i18n'
import type { TableSchema } from '@shared/tables'
import {
  TYPE_KINDS,
  defaultShow,
  defaultStore,
  type TableType,
  type TypeField,
  type TypeKind,
} from '@shared/table-types'
import {
  emptyValue,
  formatShow,
  formatStore,
  parseStore,
  tplIssues,
  typeNode,
  type TValue,
  type TypeNode,
} from '@shared/table-codec'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { ComboInput, Field, Input, Select } from '@/components/ui/input'

/** 字段类型下拉里的基础类型（也能手写 TArray<…>、别的类型名） */
const BASIC = ['int32', 'int64', 'uint8', 'uint32', 'float', 'double', 'bool', 'FString', 'FName', 'FText']

export const typeKindLabel = (k: TypeKind) =>
  ({
    struct: t('结构体'),
    alias: t('别名'),
    int: t('整数'),
    uint: t('非负整数'),
    float: t('小数'),
    bool: t('布尔'),
    string: t('文字'),
  })[k]

const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))

/** 示例值：每个叶子填 1，看得出存储和显示各是什么样 */
function sampleOf(n: TypeNode): TValue {
  if (n.k === 'scalar')
    return n.kind === 'bool' ? 'true' : n.kind === 'string' || n.kind === 'enum' || n.kind === 'other' ? 'A' : '1'
  if (n.k === 'struct') return { f: Object.fromEntries(n.fields.map((f) => [f.name, sampleOf(f.node)])) }
  if (n.k === 'list') return { items: [sampleOf(n.of), sampleOf(n.of)] }
  return { pairs: [[sampleOf(n.key), sampleOf(n.val)]] }
}

/**
 * 类型表里一个类型的编辑：名字、别名、是什么；结构体配字段（类型、范围、可不填、默认值）和存储 / 显示模板，
 * 别名配指向的类型式，基础类型配范围和正则。下面实时试一格：输入存储的原文，看拆出来显示成什么。
 * 项目设置 → 表格 → 类型、设置 → 组件里的示例共用
 */
export function TypeEditor({
  name,
  value,
  onChange,
  onRename,
  schema,
  taken,
}: {
  name: string
  value: TableType
  onChange: (v: TableType) => void
  onRename: (name: string) => void
  /** 编辑中的整份结构（类型表换成草稿）：字段类型、试一格按它展开 */
  schema: TableSchema
  /** 别的类型已经用了的名字：改名重复时提示 */
  taken: Set<string>
}) {
  const [newName, setNewName] = useState(name)
  const [sample, setSample] = useState<string | null>(null)
  const fields = value.fields ?? []
  const set = (p: Partial<TableType>) => onChange({ ...value, ...p })
  const setField = (i: number, p: Partial<TypeField>) =>
    set({ fields: fields.map((f, j) => (j === i ? { ...f, ...p } : f)) })
  const move = (i: number, d: -1 | 1) => {
    const next = [...fields]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    set({ fields: next })
  }
  const typeSuggestions = useMemo(
    () => [
      ...BASIC.map((v) => ({ value: v, group: t('基础类型') })),
      ...Object.keys(schema.types)
        .filter((n) => n !== name)
        .map((v) => ({ value: v, group: t('类型表') })),
      ...Object.keys(schema.enums).map((v) => ({ value: v, group: t('通用枚举') })),
      ...['TArray<int32>', 'TSet<FName>', 'TMap<FName, int32>'].map((v) => ({ value: v, group: t('容器') })),
    ],
    [schema.types, schema.enums, name],
  )
  const node = useMemo(() => typeNode(schema, name), [schema, name])
  const storeTpl = value.store || defaultStore(fields, schema.style.formats.field)
  const showTpl = value.show || defaultShow(fields)
  const issues =
    value.kind === 'struct' ? [...new Set([...tplIssues(storeTpl, fields), ...tplIssues(showTpl, fields)])] : []
  const codec = { formats: schema.style.formats, listSep: schema.style.listSep || ';' }
  const example = formatStore(node, sampleOf(node), codec)
  const tryText = sample ?? example
  const tried = parseStore(node, tryText, codec)
  const dupName = newName.trim() !== name && taken.has(newName.trim())
  return (
    <div className="tb:flex tb:flex-col tb:gap-3">
      <div className="tb:grid tb:gap-3 tb:sm:grid-cols-[1fr_1fr_160px]">
        <Field label={t('类型名')} error={dupName ? t('已经有这个类型了') : undefined}>
          <Input
            size="sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => newName.trim() && !dupName && newName.trim() !== name && onRename(newName.trim())}
            className="tb:font-mono"
          />
        </Field>
        <Field label={t('别名')} tip={t('表头里写这些名字也认作这个类型，逗号分隔')}>
          <Input
            size="sm"
            value={(value.aliases ?? []).join(', ')}
            onChange={(e) =>
              set({
                aliases: e.target.value
                  .split(/[,，]/)
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
            className="tb:font-mono"
          />
        </Field>
        <Field label={t('是什么')}>
          <Select
            size="sm"
            value={value.kind}
            onChange={(e) => set({ kind: e.target.value as TypeKind })}
            options={TYPE_KINDS.map((k) => ({ value: k, label: typeKindLabel(k) }))}
          />
        </Field>
      </div>

      {value.kind === 'struct' && (
        <>
          <div className="tb:flex tb:flex-col tb:gap-2" role="list" aria-label={t('字段')}>
            {fields.map((f, i) => {
              const n = i + 1
              return (
                // 一个字段两行：名字 + 类型 + 挪删；下面一行范围、默认值、可不填（编辑区窄，一行放不下）
                <div key={i} role="listitem" className="tb:flex tb:flex-col tb:gap-1.5 tb:rounded-lg tb:bg-sel tb:p-2">
                  <div className="tb:flex tb:items-center tb:gap-2">
                    <Input
                      size="sm"
                      aria-label={t('第 {n} 个字段的名字', { n })}
                      placeholder={t('字段名')}
                      value={f.name}
                      onChange={(e) => setField(i, { name: e.target.value })}
                      className="tb:w-32 tb:shrink-0 tb:font-mono"
                    />
                    <div className="tb:min-w-0 tb:flex-1">
                      <ComboInput
                        size="sm"
                        aria-label={t('第 {n} 个字段的类型', { n })}
                        placeholder={t('类型')}
                        value={f.type}
                        onChange={(v) => setField(i, { type: v })}
                        suggestions={typeSuggestions}
                        className="tb:font-mono"
                      />
                    </div>
                    <span className="tb:flex tb:shrink-0 tb:items-center">
                      <IconButton
                        icon={ArrowUp}
                        size="xs"
                        label={t('往上挪')}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      />
                      <IconButton
                        icon={ArrowDown}
                        size="xs"
                        label={t('往下挪')}
                        disabled={i === fields.length - 1}
                        onClick={() => move(i, 1)}
                      />
                      <IconButton
                        icon={X}
                        size="xs"
                        label={t('删掉字段 {f}', { f: f.name })}
                        onClick={() => set({ fields: fields.filter((_, j) => j !== i) })}
                      />
                    </span>
                  </div>
                  <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-2">
                    <Input
                      size="sm"
                      type="number"
                      aria-label={t('第 {n} 个字段的最小值', { n })}
                      placeholder={t('最小')}
                      value={f.min ?? ''}
                      onChange={(e) => setField(i, { min: num(e.target.value) })}
                      className="tb:w-20"
                    />
                    <Input
                      size="sm"
                      type="number"
                      aria-label={t('第 {n} 个字段的最大值', { n })}
                      placeholder={t('最大')}
                      value={f.max ?? ''}
                      onChange={(e) => setField(i, { max: num(e.target.value) })}
                      className="tb:w-20"
                    />
                    <Input
                      size="sm"
                      aria-label={t('第 {n} 个字段的默认值', { n })}
                      placeholder={t('默认值')}
                      value={f.default ?? ''}
                      onChange={(e) => setField(i, { default: e.target.value || undefined })}
                      className="tb:w-24 tb:font-mono"
                    />
                    <Checkbox
                      checked={!!f.optional}
                      onChange={(v) => setField(i, { optional: v || undefined })}
                      label={t('可不填')}
                    />
                  </div>
                </div>
              )
            })}
            <div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => set({ fields: [...fields, { name: `Field${fields.length + 1}`, type: 'int32' }] })}
              >
                <Plus className="tb:h-3.5 tb:w-3.5" />
                {t('加一个字段')}
              </Button>
            </div>
          </div>
          <div className="tb:grid tb:gap-3 tb:sm:grid-cols-2">
            <Field
              label={t('存储样式')}
              tip={t('表格文件里怎么写：{字段名} 是占位，其余照抄，例如 {X}#{Y}#{Z}。可不填的字段可以不出现')}
            >
              <Input
                size="sm"
                placeholder={defaultStore(fields, schema.style.formats.field)}
                value={value.store ?? ''}
                onChange={(e) => set({ store: e.target.value || undefined })}
                className="tb:font-mono"
              />
            </Field>
            <Field label={t('显示样式')} tip={t('表格页里给人看的样子，同样用 {字段名} 占位；不填就是 UE 的写法')}>
              <Input
                size="sm"
                placeholder={defaultShow(fields)}
                value={value.show ?? ''}
                onChange={(e) => set({ show: e.target.value || undefined })}
                className="tb:font-mono"
              />
            </Field>
          </div>
          {issues.length > 0 && <p className="tb:text-caption tb:text-warning">{issues.join('；')}</p>}
        </>
      )}

      {value.kind === 'alias' && (
        <Field label={t('等于哪个类型')} tip={t('写类型式，例如 TArray<int32>、TMap<FName, Reward>')}>
          <ComboInput
            size="sm"
            value={value.of ?? ''}
            onChange={(v) => set({ of: v || undefined })}
            suggestions={typeSuggestions}
            className="tb:font-mono"
          />
        </Field>
      )}

      {value.kind !== 'struct' && value.kind !== 'alias' && value.kind !== 'bool' && (
        <div className="tb:grid tb:gap-3 tb:sm:grid-cols-3">
          {value.kind !== 'string' && (
            <>
              <Field label={t('最小值')}>
                <Input
                  size="sm"
                  type="number"
                  value={value.min ?? ''}
                  onChange={(e) => set({ min: num(e.target.value) })}
                />
              </Field>
              <Field label={t('最大值')}>
                <Input
                  size="sm"
                  type="number"
                  value={value.max ?? ''}
                  onChange={(e) => set({ max: num(e.target.value) })}
                />
              </Field>
            </>
          )}
          <Field label={t('格式（正则）')} tip={t('整格要符合这个正则')}>
            <Input
              size="sm"
              value={value.pattern ?? ''}
              onChange={(e) => set({ pattern: e.target.value || undefined })}
              className="tb:font-mono"
            />
          </Field>
        </div>
      )}

      <Field label={t('说明')}>
        <Input size="sm" value={value.note ?? ''} onChange={(e) => set({ note: e.target.value || undefined })} />
      </Field>

      <div className="tb:flex tb:flex-col tb:gap-1.5 tb:rounded-lg tb:bg-sel tb:px-2.5 tb:py-2">
        <label className="tb:flex tb:items-center tb:gap-2 tb:text-caption tb:text-subtle">
          <span className="tb:shrink-0">{t('试一格（存储的原文）')}</span>
          <Input
            size="sm"
            value={tryText}
            onChange={(e) => setSample(e.target.value)}
            className="tb:min-w-0 tb:flex-1 tb:font-mono"
          />
        </label>
        <p className={cn('tb:break-all tb:font-mono tb:text-caption', tried.ok ? 'tb:text-fg' : 'tb:text-danger')}>
          {tried.ok ? `→ ${formatShow(node, tried.v, schema.style.formats) || '—'}` : tried.err}
        </p>
        {node.k !== 'scalar' && !tried.ok && (
          <button
            type="button"
            className="tb:self-start tb:text-caption tb:text-accent tb:hover:underline"
            onClick={() => setSample(formatStore(node, emptyValue(node), codec))}
          >
            {t('换成空值')}
          </button>
        )}
      </div>
    </div>
  )
}
