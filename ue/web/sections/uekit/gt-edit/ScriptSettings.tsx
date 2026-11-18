import { Crosshair, Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { GtGuard, GtScript } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { parseScalar, scalarText } from '../gt-cond/compare.tsx'
import { GuardList } from '../gt-guards/GuardList.tsx'
import { blankGuard } from '../gt-guards/model.ts'
import { ObjectKeyDialog, type Locator } from '../gt-vars/ObjectKeyDialog.tsx'

type Params = NonNullable<GtScript['params']>
const PARAM_TYPES = ['', 'string', 'int', 'float', 'bool', 'vector', 'object', 'any']
const NAME = /^[A-Za-z_]\w*$/

/**
 * 什么都没选时右栏显示脚本本身的设置（协议第 1 节）：名字、参数（被调用时传入）、变量（初始值）、
 * 对象（定位器，运行时按它找）、这个脚本自己的守护（只在跑这个脚本和它调用的脚本时生效）
 */
export function ScriptSettings({ doc, onChange }: { doc: GtScript; onChange: (d: GtScript) => void }) {
  const { ui } = h()
  const [obj, setObj] = useState<{ name?: string; value?: Locator }>()
  const set = (k: keyof GtScript, v: unknown) => {
    const out = { ...doc }
    if (v === undefined || (typeof v === 'object' && v && !Object.keys(v).length)) delete out[k]
    else out[k] = v
    onChange(out)
  }
  const params: Params = doc.params ?? {}
  const vars = doc.vars ?? {}
  const objects = (doc.objects ?? {}) as Record<string, Locator>
  const guards = doc.guards ?? []

  /** 改名：保持原来的顺序 */
  const rename = <T,>(rec: Record<string, T>, from: string, to: string) =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k === from ? to : k, v]))
  const fresh = (rec: Record<string, unknown>, base: string) => {
    let n = 1
    while (`${base}${n}` in rec) n++
    return `${base}${n}`
  }
  const nameInput = (name: string, onRename: (to: string) => void) => (
    <ui.Input
      size="sm"
      className="ue:w-32 ue:shrink-0 ue:font-mono"
      defaultValue={name}
      onBlur={(e: { target: { value: string } }) => {
        const v = e.target.value.trim()
        if (v !== name && NAME.test(v)) onRename(v)
        else e.target.value = name
      }}
    />
  )

  return (
    <div className="ue:flex ue:flex-col ue:gap-5 ue:p-4">
      <Section title={t('脚本')}>
        <ui.Input
          size="sm"
          placeholder={t('场景名（报告里显示）')}
          value={typeof doc.name === 'string' ? doc.name : ''}
          onChange={(e: { target: { value: string } }) => set('name', e.target.value || undefined)}
        />
      </Section>

      <Section
        title={t('参数')}
        hint={t('被调用时传进来（调用脚本的「参数」、运行时的 params），脚本里写 $名字')}
        onAdd={() => set('params', { ...params, [fresh(params, 'p')]: { default: '' } })}
      >
        {Object.entries(params).map(([k, p]) => (
          <div key={k} className="ue:flex ue:items-center ue:gap-1.5">
            {nameInput(k, (to) => set('params', rename(params, k, to)))}
            <ui.Input
              size="sm"
              className="ue:min-w-0 ue:flex-1 ue:font-mono"
              placeholder={t('默认值')}
              value={scalarText(p.default)}
              onChange={(e: { target: { value: string } }) =>
                set('params', { ...params, [k]: { ...p, default: parseScalar(e.target.value) } })
              }
            />
            <ui.Select
              size="sm"
              className="ue:w-24"
              value={p.type ?? ''}
              onChange={(e: { target: { value: string } }) => {
                const next = { ...p }
                if (e.target.value) next.type = e.target.value
                else delete next.type
                set('params', { ...params, [k]: next })
              }}
              options={PARAM_TYPES.map((x) => ({ value: x, label: x || t('自动') }))}
            />
            <ui.IconButton icon={Trash2} size="xs" label={t('删掉')} onClick={() => set('params', omit(params, k))} />
          </div>
        ))}
      </Section>

      <Section
        title={t('变量')}
        hint={t('初始值；跑的时候用「设变量」改，条件和表达式里写 $名字')}
        onAdd={() => set('vars', { ...vars, [fresh(vars, 'v')]: 0 })}
      >
        {Object.entries(vars).map(([k, v]) => (
          <div key={k} className="ue:flex ue:items-center ue:gap-1.5">
            {nameInput(k, (to) => set('vars', rename(vars, k, to)))}
            <ui.Input
              size="sm"
              className="ue:min-w-0 ue:flex-1 ue:font-mono"
              value={scalarText(v)}
              onChange={(e: { target: { value: string } }) => set('vars', { ...vars, [k]: parseScalar(e.target.value) })}
            />
            <ui.IconButton icon={Trash2} size="xs" label={t('删掉')} onClick={() => set('vars', omit(vars, k))} />
          </div>
        ))}
      </Section>

      <Section
        title={t('对象')}
        hint={t('只存类和唯一标识，运行时按它重新找；条件和调函数里写 @obj.名字')}
        onAdd={() => setObj({})}
      >
        {Object.entries(objects).map(([k, o]) => (
          <div key={k} className="ue:flex ue:items-center ue:gap-1.5 ue:text-footnote">
            <Crosshair className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
            <button
              type="button"
              className="ue:flex ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:items-center ue:gap-2 ue:text-left"
              onClick={() => setObj({ name: k, value: o })}
            >
              <span className="ue:font-mono ue:text-fg">{k}</span>
              <span className="ue:truncate ue:font-mono ue:text-subtle">
                {o.class}
                {o.key ? ` · ${Object.keys(o.key).join(', ')}` : ` · ${t('按第一个找')}`}
              </span>
            </button>
            <ui.IconButton icon={Trash2} size="xs" label={t('删掉')} onClick={() => set('objects', omit(objects, k))} />
          </div>
        ))}
      </Section>

      <Section
        title={t('这个脚本的守护')}
        hint={t('只在跑这个脚本（和它调用的脚本）时生效，先于全局守护')}
        onAdd={() => set('guards', [...guards, blankGuard(new Set(guards.map((g) => g.id ?? '')))])}
      >
        {guards.length > 0 && <GuardList value={guards} onChange={(v: GtGuard[]) => set('guards', v.length ? v : undefined)} />}
      </Section>

      {obj && (
        <ObjectKeyDialog
          name={obj.name}
          value={obj.value}
          onClose={() => setObj(undefined)}
          onSave={(name, loc) => {
            const base = obj.name && obj.name !== name ? rename(objects, obj.name, name) : objects
            set('objects', { ...base, [name]: loc })
            setObj(undefined)
          }}
        />
      )}
    </div>
  )
}

function omit<T>(rec: Record<string, T>, k: string) {
  const out = { ...rec }
  delete out[k]
  return out
}

function Section({ title, hint, onAdd, children }: { title: string; hint?: string; onAdd?: () => void; children: ReactNode }) {
  const { ui } = h()
  return (
    <section className="ue:flex ue:flex-col ue:gap-1.5">
      <div className="ue:flex ue:items-center ue:gap-2">
        <span className="ue:text-footnote ue:font-medium ue:text-fg">{title}</span>
        {onAdd && (
          <ui.Button size="sm" variant="ghost" className="ue:ml-auto" onClick={onAdd}>
            <Plus className="ue:h-3.5 ue:w-3.5" />
            {t('添加')}
          </ui.Button>
        )}
      </div>
      {hint && <p className="ue:text-caption ue:text-subtle">{hint}</p>}
      {children}
    </section>
  )
}
