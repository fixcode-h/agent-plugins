import { Wand2 } from 'lucide-react'
import { useState } from 'react'
import type { GmRef } from '../../../../shared/gt-script/gm/expand.ts'
import { h, t } from '../../../host.ts'
import { useGm } from '../../gm/use-gm.ts'
import { entryOfRef, KIND_LABEL, refText } from './gm-ref.ts'
import { GmPickDialog, KIND_ICON } from './GmPickDialog.tsx'

/** 参数能不能写 $变量 / 表达式：拼进代码文字的（Lua、控制台）不行，运行时求值的（C++、自定义 GM）行 */
const DYNAMIC_OK = new Set(['cpp', 'custom'])

/**
 * 一条 GM 引用的编辑（「执行 GM」节点的检查器、附带 GM 的一项）：哪条 GM（点了换）、说明、参数。
 * 参数照 GM 页的定义列：C++ / Lua 按顺序，自定义 GM 只列它的可改参数（不能改的灰着显示存的值）。
 * withRet：附带 GM 的成功后 / 失败时那两组，参数提示里写上 $ret
 */
export function GmRefEditor({ value, onChange, withRet }: { value: GmRef; onChange: (v: GmRef) => void; withRet?: boolean }) {
  const { ui } = h()
  const data = useGm(0)
  const [picking, setPicking] = useState(!value.name)
  const entry = value.name ? entryOfRef(value, data.entries) : undefined
  const macro = value.kind === 'macro' ? data.gm.macros.find((m) => m.id === value.name) : undefined
  const missing = !!value.name && !entry && !macro && !(value.kind === 'console') && !data.lua.loading && !data.cpp.loading
  const Icon = KIND_ICON[value.kind] ?? Wand2
  const hint = DYNAMIC_OK.has(value.kind)
    ? withRet
      ? t('值，或 $变量、= 表达式、$ret（这一步的返回）')
      : t('值，或 $变量、= 表达式')
    : t('值（Lua、控制台的参数要拼进代码，不能用变量）')

  const setArg = (k: string | number, v: string) => {
    if (typeof k === 'number') {
      const list = Array.isArray(value.args) ? [...value.args] : []
      list[k] = v
      onChange({ ...value, args: list })
    } else {
      const obj = value.args && !Array.isArray(value.args) ? { ...value.args } : {}
      if (v === '') delete obj[k]
      else obj[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
      onChange({ ...value, args: obj })
    }
  }
  const text = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v))

  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:px-2.5 ue:py-1.5">
        <Icon className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-run" />
        <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-footnote ue:font-medium ue:text-fg">
          {value.name ? (value.label ?? value.name) : t('还没选 GM')}
        </span>
        {value.name && <span className="ue:shrink-0 ue:text-caption ue:text-subtle">{KIND_LABEL[value.kind]()}</span>}
        <ui.Button size="sm" variant="secondary" className="ue:ml-auto ue:shrink-0" onClick={() => setPicking(true)}>
          {value.name ? t('换 GM…') : t('选 GM…')}
        </ui.Button>
      </div>
      {missing && (
        <span className="ue:text-caption ue:text-danger">
          {t('GM 库里找不到它了：存盘和运行时这一步会失败，换一条或去 GM 页加回来')}
        </span>
      )}
      {entry?.desc && <span className="ue:text-caption ue:text-subtle">{entry.desc}</span>}
      {macro && (
        <span className="ue:text-caption ue:text-subtle">
          {t('宏 {n} 步：{s}', {
            n: macro.steps.length,
            s: macro.steps
              .map((s) => (s.wait !== undefined ? t('等 {n} 秒', { n: s.wait }) : (s.gm ?? s.lua ?? s.console ?? s.custom)))
              .join(' → '),
          })}
        </span>
      )}
      {(value.kind === 'cpp' || value.kind === 'lua') &&
        entry?.params.map((p, i) => (
          <label key={p.name} className="ue:flex ue:items-center ue:gap-2">
            <span className="ue:w-24 ue:shrink-0 ue:truncate ue:font-mono ue:text-caption ue:text-muted">{p.name}</span>
            <ui.Input
              size="sm"
              spellCheck={false}
              className="ue:min-w-0 ue:flex-1 ue:font-mono"
              placeholder={p.type ? `${p.type} · ${hint}` : hint}
              value={text(Array.isArray(value.args) ? value.args[i] : undefined)}
              onChange={(e: { target: { value: string } }) => setArg(i, e.target.value)}
            />
          </label>
        ))}
      {value.kind === 'custom' &&
        entry?.custom &&
        Object.entries(entry.custom.args).map(([k, v]) => {
          const editable = entry.custom!.editable.includes(k)
          const cur = value.args && !Array.isArray(value.args) && k in value.args ? value.args[k] : undefined
          return (
            <label key={k} className="ue:flex ue:items-center ue:gap-2">
              <span className="ue:w-24 ue:shrink-0 ue:truncate ue:font-mono ue:text-caption ue:text-muted">{k}</span>
              <ui.Input
                size="sm"
                spellCheck={false}
                disabled={!editable}
                className="ue:min-w-0 ue:flex-1 ue:font-mono"
                placeholder={editable ? `${text(v)} · ${hint}` : t('存的值，执行时不能改')}
                value={editable ? text(cur) : text(v)}
                onChange={(e: { target: { value: string } }) => setArg(k, e.target.value)}
              />
            </label>
          )
        })}
      {value.kind === 'cpp' && !entry && value.name && (
        <span className="ue:text-caption ue:text-subtle">{t('UE 没在运行，列不出 C++ GM 的参数；参数照存的：{a}', { a: refText(value) })}</span>
      )}
      {picking && (
        <GmPickDialog
          onClose={() => setPicking(false)}
          onPick={(ref) => {
            setPicking(false)
            onChange(ref)
          }}
        />
      )}
    </div>
  )
}
