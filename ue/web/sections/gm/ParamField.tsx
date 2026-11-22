import { Table } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LuaGmBinding, LuaGmConfig } from '../../../server/lua-gm/types.ts'
import type { GmStore } from '../../../server/types.ts'
import { op, useLoad } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { bindingOf, type GmEntry, type GmParam } from './data.ts'
import { TablePick } from './TablePick.tsx'
import { labelOf, resolveHint, searchRows } from './tables.ts'

const isBool = (p: GmParam) => /^(bool|boolean)$/i.test(p.type)

/**
 * 一个参数的输入：枚举、布尔出下拉；关联了表格列的出可搜索下拉（经表格插件，Lua、C++ 共用一种关联）；其它是输入框
 */
export function ParamField({
  entry,
  p,
  value,
  onChange,
  config,
  gm,
  onEditBinding,
}: {
  entry: GmEntry
  p: GmParam
  value: string
  onChange: (v: string) => void
  config?: LuaGmConfig
  gm: GmStore
  onEditBinding: (p: GmParam, current?: LuaGmBinding) => void
}) {
  const { ui } = h()
  const input = (
    <ui.Input
      size="sm"
      className="ue:flex-1 ue:font-mono"
      value={value}
      placeholder={p.default !== undefined ? t('留空用默认 {v}', { v: p.default }) : ''}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
    />
  )
  let field = input
  if (p.enum?.length || isBool(p))
    field = (
      <ui.Select
        size="sm"
        className="ue:flex-1"
        value={value}
        onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
        options={[{ value: '', label: '—' }, ...(p.enum ?? ['true', 'false']).map((x) => ({ value: x, label: x }))]}
      />
    )
  else
    field = (
      <TableField
        entry={entry}
        p={p}
        value={value}
        onChange={onChange}
        config={config}
        gm={gm}
        fallback={input}
        onEditBinding={onEditBinding}
      />
    )

  return (
    <label className="ue:grid ue:grid-cols-[minmax(96px,30%)_1fr] ue:items-center ue:gap-3">
      <span className="ue:min-w-0 ue:truncate ue:text-footnote" title={p.desc || p.type}>
        <span className="ue:font-mono ue:text-fg">{p.name}</span> <span className="ue:text-subtle">{p.type}</span>
        {p.desc && <span className="ue:block ue:truncate ue:text-caption ue:text-subtle">{p.desc}</span>}
      </span>
      <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">{field}</span>
    </label>
  )
}

/**
 * 关联了表格列的参数（Lua、C++ 共用）：有关联出可搜索的下拉；扫描脚本给的提示（Item.Id）先换成表格文件和列，
 * 表格插件没装时退回输入框。C++ GM 以前绑的 DataTable（只填资源路径）还认，下拉列行名；点表格图标改成关联表格
 */
function TableField({
  entry,
  p,
  value,
  onChange,
  config,
  gm,
  fallback,
  onEditBinding,
}: {
  entry: GmEntry
  p: GmParam
  value: string
  onChange: (v: string) => void
  config?: LuaGmConfig
  gm: GmStore
  fallback: React.ReactNode
  onEditBinding: (p: GmParam, current?: LuaGmBinding) => void
}) {
  const { project } = useUe()
  const { ui } = h()
  const key = `${entry.name}.${p.name}`
  const lua = entry.src === 'lua' ? bindingOf(entry, p, config) : undefined
  const binding = lua ? lua.binding : gm.tableBindings?.[key]
  const hint = lua?.hint
  const edited = lua ? lua.edited : !!binding
  const legacy = !lua && !binding ? (gm.bindings?.[key] ?? '') : ''
  const [label, setLabel] = useState('')
  const resolved = useLoad(
    () =>
      binding
        ? Promise.resolve(binding)
        : hint
          ? resolveHint(project.id, hint.table, hint.key)
          : Promise.resolve(undefined),
    [project.id, JSON.stringify(binding), hint?.table, hint?.key],
  )
  const dtRows = useLoad(
    () =>
      legacy
        ? op<{ rows: { name: string }[] }>(project.id, 'datatable', { path: legacy, limit: 1000 }).then((r) =>
            r.rows.map((x) => x.name),
          )
        : Promise.resolve([] as string[]),
    [legacy],
  )
  const b = resolved.data
  // 从常用、最近执行填回来的值：补上描述
  useEffect(() => {
    if (!b || !value || label) return
    labelOf(project.id, b, value).then(setLabel, () => undefined)
    // 只在值、关联变了时补
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [value, b?.table])
  if (!b)
    return (
      <>
        {legacy && dtRows.data?.length ? (
          <ui.Select
            size="sm"
            className="ue:flex-1"
            value={value}
            placeholder={legacy.split('/').pop()}
            onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
            options={dtRows.data.map((x) => ({ value: x, label: x }))}
          />
        ) : (
          fallback
        )}
        {(hint || edited) && resolved.error ? (
          <span className="ue:max-w-60 ue:shrink-0 ue:truncate ue:text-caption ue:text-warning" title={resolved.error}>
            {/* 没装表格插件的那句本身说得清，不再加「读不到关联的表」 */}
            {/^没装|tables plugin/.test(resolved.error)
              ? resolved.error
              : t('读不到关联的表：{msg}', { msg: resolved.error })}
          </span>
        ) : null}
        <button
          type="button"
          title={
            legacy
              ? t('以前绑的 DataTable：{dt}。点这里改成关联表格的列（下拉里能搜）', { dt: legacy })
              : t('关联表格的列：下拉里按主列、描述列搜')
          }
          onClick={() => onEditBinding(p, undefined)}
          className="ue:grid ue:shrink-0 ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
        >
          <Table className="ue:h-3.5 ue:w-3.5" />
        </button>
      </>
    )
  const where = `${b.table.split('/').pop()}${b.sheet ? ` · ${b.sheet}` : ''}`
  return (
    <TablePick
      value={value}
      label={label}
      binding={b}
      load={(q) => searchRows(project.id, b, q)}
      onChange={(v, l) => {
        setLabel(l)
        onChange(v)
      }}
      footer={
        <>
          <span className="ue:min-w-0 ue:truncate">
            {edited
              ? t('关联 {p} → {table} 的 {key}', { p: p.name, table: where, key: b.key })
              : t('关联 {p} → {table} 的 {key}（扫描脚本按注释给的）', { p: p.name, table: where, key: b.key })}
          </span>
          <button
            type="button"
            onClick={() => onEditBinding(p, b)}
            className="ue:ml-auto ue:shrink-0 ue:cursor-pointer ue:text-accent-text ue:hover:underline"
          >
            {t('改关联')}
          </button>
        </>
      }
    />
  )
}
