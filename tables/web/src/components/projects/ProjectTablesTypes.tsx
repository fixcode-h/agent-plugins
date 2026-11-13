import { useMemo, useState } from 'react'
import { Download, Plus, Search, Trash2 } from 'lucide-react'
import { t } from '@shared/i18n'
import type { TableSchema } from '@shared/tables'
import type { TableType, TableTypes, TypeFormats } from '@shared/table-types'
import { ueTypes } from '@shared/table-types-ue'
import { saveTableSchema, useSchemaDraft, useTableSchema } from '@/lib/table-schema'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/icon-button'
import { TypeEditor, typeKindLabel } from '@/components/tables/TypeEditor'

interface Draft {
  types: TableTypes
  formats: TypeFormats
}
const toDraft = (s: TableSchema): Draft => ({ types: s.types, formats: s.style.formats })

/**
 * 项目设置 → 表格 → 类型：项目的类型表（自定义结构体、别名、带范围的基础类型）和数组、映射的写法。
 * 左边类型列表，右边改一个；能一键导入 UE 常用类型。存在表格结构文件（types.json、style），单独保存
 */
export function ProjectTablesTypes({ projectId }: { projectId: string }) {
  const { schema, error } = useTableSchema(projectId)
  const { draft: d, saved, changed, setDraft, reset } = useSchemaDraft(schema, toDraft)
  const setD = (f: (x: Draft) => Draft) => setDraft(f)
  const [cur, setCur] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  // 编辑中的整份结构：字段类型、试一格按草稿展开
  const live = useMemo(
    () => (schema && d ? { ...schema, types: d.types, style: { ...schema.style, formats: d.formats } } : null),
    [schema, d],
  )
  if (error) return <p className="tb:text-footnote tb:text-danger">{error}</p>
  if (!d || !live) return null
  const names = Object.keys(d.types).sort((a, b) => a.localeCompare(b))
  const shown = q.trim() ? names.filter((n) => n.toLowerCase().includes(q.trim().toLowerCase())) : names
  const sel = cur && d.types[cur] ? cur : (shown[0] ?? null)
  const putType = (name: string, v: TableType) => setD((x) => ({ ...x, types: { ...x.types, [name]: v } }))
  const rename = (from: string, to: string) => {
    // 保持原来的顺序：在原位置换键
    setD((x) => ({
      ...x,
      types: Object.fromEntries(Object.entries(x.types).map(([k, v]) => [k === from ? to : k, v])),
    }))
    setCur(to)
  }
  const add = () => {
    let n = 'FMyStruct'
    for (let i = 2; d.types[n]; i++) n = `FMyStruct${i}`
    putType(n, { kind: 'struct', fields: [{ name: 'Value', type: 'int32' }] })
    setCur(n)
  }
  const importUe = () => {
    const ue = ueTypes()
    const fresh = Object.keys(ue).filter((n) => !d.types[n])
    setD((x) => ({ ...x, types: { ...x.types, ...Object.fromEntries(fresh.map((n) => [n, ue[n]])) } }))
    toast.success(
      fresh.length < Object.keys(ue).length
        ? t('加了 {n} 个 UE 常用类型；已有的 {m} 个同名类型没动', {
            n: fresh.length,
            m: Object.keys(ue).length - fresh.length,
          })
        : t('加了 {n} 个 UE 常用类型', { n: fresh.length }),
    )
  }
  const save = async () => {
    setBusy(true)
    try {
      reset(
        await saveTableSchema(projectId, (c) => ({
          ...c,
          types: d.types,
          style: { ...c.style, formats: d.formats },
        })),
      )
      toast.success(t('已保存类型'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="tb:flex tb:flex-col tb:gap-4">
      <p className="tb:text-footnote tb:leading-relaxed tb:text-subtle">
        {t(
          '表头类型行里写的类型名在这里定义：结构体有哪些字段、表格文件里怎么存（存储样式）、表格页里怎么显示（显示样式）。表格文件不会因此改动，只有在弹窗里改了值才按存储样式写回。',
        )}
      </p>
      <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-2">
        <Button size="sm" variant="secondary" onClick={importUe}>
          <Download className="tb:h-3.5 tb:w-3.5" />
          {t('导入 UE 常用类型')}
        </Button>
        <Button size="sm" variant="ghost" onClick={add}>
          <Plus className="tb:h-3.5 tb:w-3.5" />
          {t('加一个类型')}
        </Button>
      </div>
      {names.length === 0 ? (
        <p className="tb:rounded-lg tb:bg-sel tb:px-3 tb:py-2.5 tb:text-footnote tb:text-subtle">
          {t('还没有自定义类型。int32、float、FString 这些基础类型不用加；结构体、别名从上面加，或导入 UE 常用类型。')}
        </p>
      ) : (
        <div className="tb:grid tb:gap-3 tb:md:grid-cols-[220px_1fr]">
          <div className="tb:flex tb:flex-col tb:gap-1.5">
            <label className="tb:relative">
              <Search className="tb:pointer-events-none tb:absolute tb:top-2 tb:left-2 tb:h-3.5 tb:w-3.5 tb:text-subtle" />
              <Input
                size="sm"
                aria-label={t('搜类型')}
                placeholder={t('搜类型')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="tb:pl-7"
              />
            </label>
            <ul
              className="thin-scroll tb:flex tb:max-h-[420px] tb:flex-col tb:gap-0.5 tb:overflow-y-auto"
              aria-label={t('类型')}
            >
              {shown.map((n) => (
                <li key={n}>
                  <button
                    type="button"
                    aria-current={n === sel || undefined}
                    onClick={() => setCur(n)}
                    className={cn(
                      'tb:group tb:flex tb:w-full tb:items-center tb:gap-2 tb:rounded-md tb:px-2 tb:py-1 tb:text-left tb:text-footnote',
                      n === sel ? 'tb:bg-active tb:text-fg' : 'tb:text-muted tb:hover:bg-hover',
                    )}
                  >
                    <span className="tb:min-w-0 tb:flex-1 tb:truncate tb:font-mono">{n}</span>
                    <span className="tb:shrink-0 tb:text-caption tb:text-subtle">{typeKindLabel(d.types[n].kind)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {sel && (
            <div className="tb:min-w-0 tb:rounded-(--c-card-radius) tb:border tb:p-3">
              <div className="tb:mb-2 tb:flex tb:items-center">
                <span className="tb:font-mono tb:text-body tb:font-medium">{sel}</span>
                <IconButton
                  icon={Trash2}
                  className="tb:ml-auto"
                  label={t('删掉类型 {n}', { n: sel })}
                  onClick={() =>
                    setD((x) => ({
                      ...x,
                      types: Object.fromEntries(Object.entries(x.types).filter(([k]) => k !== sel)),
                    }))
                  }
                />
              </div>
              <TypeEditor
                key={sel}
                name={sel}
                value={d.types[sel]}
                onChange={(v) => putType(sel, v)}
                onRename={(to) => rename(sel, to)}
                schema={live}
                taken={new Set(names)}
              />
            </div>
          )}
        </div>
      )}
      <FormatsEditor
        value={d.formats}
        onChange={(formats) => setD((x) => ({ ...x, formats }))}
        listSep={live.style.listSep}
      />
      <div className="tb:flex tb:items-center tb:justify-end tb:gap-2">
        {changed && (
          <span className="tb:mr-auto tb:text-caption tb:text-subtle">{t('类型存在表格结构文件里，单独保存')}</span>
        )}
        <Button size="sm" variant="secondary" disabled={!changed || busy} onClick={() => saved && setD(() => saved)}>
          {t('还原')}
        </Button>
        <Button size="sm" disabled={!changed || busy} onClick={() => void save()}>
          {t('保存类型')}
        </Button>
      </div>
    </div>
  )
}

/** 数组、映射、结构体默认的写法：每种「存储」「显示」各一行，外面包的符号 + 分隔符（映射另有一对的模板） */
function FormatsEditor({
  value: f,
  onChange,
  listSep,
}: {
  value: TypeFormats
  onChange: (f: TypeFormats) => void
  listSep: string
}) {
  const cell = (label: string, v: string, put: (v: string) => void, w = 'tb:w-16', min = 0) => (
    <Input
      size="sm"
      aria-label={label}
      title={label}
      placeholder={min ? '' : t('无')}
      value={v}
      maxLength={label.includes('{') ? 40 : 8}
      onChange={(e) => (min && !e.target.value ? undefined : put(e.target.value))}
      className={cn(w, 'tb:text-center tb:font-mono')}
    />
  )
  const row = (title: string, parts: React.ReactNode) => (
    <div className="tb:flex tb:flex-wrap tb:items-center tb:gap-2 tb:text-footnote tb:text-muted">
      <span className="tb:w-24 tb:shrink-0">{title}</span>
      {parts}
    </div>
  )
  const sub = (s: string) => <span className="tb:text-caption tb:text-subtle">{s}</span>
  return (
    <Field
      label={t('容器的写法')}
      tip={t(
        'TArray、TSet、TMap 和没写存储样式的结构体在格子里怎么写。左右括号可以不填；数组存储的分隔符在「表头」页的数组分隔符',
      )}
    >
      <div className="tb:flex tb:flex-col tb:gap-2 tb:rounded-lg tb:bg-sel tb:px-3 tb:py-2.5">
        {row(
          t('数组 · 存储'),
          <>
            {sub(t('左'))}
            {cell(t('数组存储的左括号'), f.listStore.open, (v) =>
              onChange({ ...f, listStore: { ...f.listStore, open: v } }),
            )}
            {sub(t('分隔 {sep}', { sep: listSep || ';' }))}
            {sub(t('右'))}
            {cell(t('数组存储的右括号'), f.listStore.close, (v) =>
              onChange({ ...f, listStore: { ...f.listStore, close: v } }),
            )}
            {sub(t('第二层分隔'))}
            {cell(
              t('第二层数组的分隔符'),
              f.listStore.inner,
              (v) => onChange({ ...f, listStore: { ...f.listStore, inner: v } }),
              'tb:w-16',
              1,
            )}
          </>,
        )}
        {row(
          t('数组 · 显示'),
          <>
            {sub(t('左'))}
            {cell(t('数组显示的左括号'), f.listShow.open, (v) =>
              onChange({ ...f, listShow: { ...f.listShow, open: v } }),
            )}
            {sub(t('分隔'))}
            {cell(
              t('数组显示的分隔符'),
              f.listShow.sep,
              (v) => onChange({ ...f, listShow: { ...f.listShow, sep: v } }),
              'tb:w-16',
              1,
            )}
            {sub(t('右'))}
            {cell(t('数组显示的右括号'), f.listShow.close, (v) =>
              onChange({ ...f, listShow: { ...f.listShow, close: v } }),
            )}
          </>,
        )}
        {(['mapStore', 'mapShow'] as const).map((k) =>
          row(
            k === 'mapStore' ? t('映射 · 存储') : t('映射 · 显示'),
            <>
              {sub(t('左'))}
              {cell(t('映射的左括号'), f[k].open, (v) => onChange({ ...f, [k]: { ...f[k], open: v } }))}
              {sub(t('一对'))}
              {cell(
                t('映射一对的模板，{K} 是键、{V} 是值'),
                f[k].entry,
                (v) => onChange({ ...f, [k]: { ...f[k], entry: v } }),
                'tb:w-28',
                1,
              )}
              {sub(t('分隔'))}
              {cell(t('映射的分隔符'), f[k].sep, (v) => onChange({ ...f, [k]: { ...f[k], sep: v } }), 'tb:w-16', 1)}
              {sub(t('右'))}
              {cell(t('映射的右括号'), f[k].close, (v) => onChange({ ...f, [k]: { ...f[k], close: v } }))}
            </>,
          ),
        )}
        {row(
          t('结构体字段'),
          <>
            {sub(t('没写存储样式时，字段之间用'))}
            {cell(t('结构体字段的分隔符'), f.field, (v) => onChange({ ...f, field: v }), 'tb:w-16', 1)}
          </>,
        )}
      </div>
    </Field>
  )
}
