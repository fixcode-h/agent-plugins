import { Table } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LuaGmBinding, LuaGmConfig } from '../../../server/lua-gm/types.ts'
import type { GmStore } from '../../../server/types.ts'
import { op, useLoad } from '../../api.ts'
import { useAsk } from '../../ask.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { bindingOf, type GmEntry, type GmParam } from './data.ts'
import { TablePick } from './TablePick.tsx'
import { labelOf, resolveHint, searchRows } from './tables.ts'

const isBool = (p: GmParam) => /^(bool|boolean)$/i.test(p.type)

/**
 * 一个参数的输入：枚举、布尔出下拉；Lua GM 关联了表格列的出可搜索下拉（经表格插件）；
 * C++ GM 沿用以前的「绑定 DataTable」（gm.json 的 bindings，下拉列行名）；其它是输入框
 */
export function ParamField({
  entry,
  p,
  value,
  onChange,
  config,
  gm,
  onGm,
  onEditBinding,
}: {
  entry: GmEntry
  p: GmParam
  value: string
  onChange: (v: string) => void
  config?: LuaGmConfig
  gm: GmStore
  onGm: (s: GmStore) => unknown
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
  else if (entry.src === 'lua') field = <LuaTableField entry={entry} p={p} value={value} onChange={onChange} config={config} fallback={input} onEditBinding={onEditBinding} />
  else field = <CppField entry={entry} p={p} value={value} onChange={onChange} gm={gm} onGm={onGm} input={input} />

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

function LuaTableField({
  entry,
  p,
  value,
  onChange,
  config,
  fallback,
  onEditBinding,
}: {
  entry: GmEntry
  p: GmParam
  value: string
  onChange: (v: string) => void
  config?: LuaGmConfig
  fallback: React.ReactNode
  onEditBinding: (p: GmParam, current?: LuaGmBinding) => void
}) {
  const { project } = useUe()
  const { binding, hint, edited } = bindingOf(entry, p, config)
  const [label, setLabel] = useState('')
  // 扫描脚本给的提示（Item.Id）要先换成表格文件和列；表格插件没装时这里报错，退回输入框
  const resolved = useLoad(
    () =>
      binding
        ? Promise.resolve(binding)
        : hint
          ? resolveHint(project.id, hint.table, hint.key)
          : Promise.resolve(undefined),
    [project.id, JSON.stringify(binding), hint?.table, hint?.key],
  )
  const b = resolved.data
  // 从收藏、最近执行填回来的值：补上名字
  useEffect(() => {
    if (!b || !value || label) return
    labelOf(project.id, b, value).then(setLabel, () => undefined)
    // 只在值、关联变了时补
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [value, b?.table])
  const edit = (
    <button
      type="button"
      onClick={() => onEditBinding(p, b)}
      className="ue:ml-auto ue:shrink-0 ue:cursor-pointer ue:text-accent-text ue:hover:underline"
    >
      {t('改关联')}
    </button>
  )
  if (!b)
    return (
      <>
        {fallback}
        {(hint || edited) && resolved.error ? (
          <span className="ue:max-w-48 ue:shrink-0 ue:truncate ue:text-caption ue:text-warning" title={resolved.error}>
            {t('读不到关联的表：{msg}', { msg: resolved.error })}
          </span>
        ) : null}
        <button
          type="button"
          title={t('关联表格的列：下拉里按 Id 或名字搜')}
          onClick={() => onEditBinding(p, undefined)}
          className="ue:grid ue:shrink-0 ue:cursor-pointer ue:text-subtle ue:hover:text-fg"
        >
          <Table className="ue:h-3.5 ue:w-3.5" />
        </button>
      </>
    )
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
              ? t('关联 {p} → {table} 的 {key}（GM 设置里改的）', { p: p.name, table: b.table, key: b.key })
              : t('关联 {p} → {table} 的 {key}（扫描脚本按注释给的）', { p: p.name, table: b.table, key: b.key })}
          </span>
          {edit}
        </>
      }
    />
  )
}

/** C++ GM：参数绑定 DataTable 后下拉列行名（设计文档 3.3，沿用以前的 gm.json bindings） */
function CppField({
  entry,
  p,
  value,
  onChange,
  gm,
  onGm,
  input,
}: {
  entry: GmEntry
  p: GmParam
  value: string
  onChange: (v: string) => void
  gm: GmStore
  onGm: (s: GmStore) => unknown
  input: React.ReactNode
}) {
  const { project } = useUe()
  const { ui } = h()
  const key = `${entry.name}.${p.name}`
  const bound = gm.bindings?.[key] ?? ''
  const rows = useLoad(
    () =>
      bound
        ? op<{ rows: { name: string }[] }>(project.id, 'datatable', { path: bound, limit: 1000 }).then((r) =>
            r.rows.map((x) => x.name),
          )
        : Promise.resolve([] as string[]),
    [bound],
  )
  const [dialog, ask] = useAsk()
  const bind = async () => {
    const path = await ask({
      title: t('绑定 DataTable'),
      label: t('DataTable 资源路径，例如 /Game/Data/DT_Items；留空取消绑定'),
      init: bound,
      allowEmpty: true,
    })
    if (path === undefined) return
    const bindings = { ...(gm.bindings ?? {}) }
    if (path.trim()) bindings[key] = path.trim()
    else delete bindings[key]
    void onGm({ ...gm, bindings })
  }
  return (
    <>
      {dialog}
      {bound && rows.data?.length ? (
        <ui.Select
          size="sm"
          className="ue:flex-1"
          value={value}
          placeholder={bound.split('/').pop()}
          onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
          options={rows.data.map((x) => ({ value: x, label: x }))}
        />
      ) : (
        input
      )}
      <ui.IconButton
        icon={Table}
        label={bound ? t('已绑定 {dt}（点击修改）', { dt: bound }) : t('绑定数据表')}
        size="xs"
        onClick={() => void bind()}
      />
    </>
  )
}
