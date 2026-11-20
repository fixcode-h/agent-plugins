import { Switch } from '@panel/web/src/components/ui/switch'
import type { GtStep } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import type { GtRefLike } from '../../../../../shared/gt-script/ref/types.ts'
import { parseScalar, scalarText } from '../../gt-cond/compare.tsx'
import { TargetInput } from '../../gt-cond/TargetInput.tsx'
import { ValueInput } from '../../gt-cond/ValueInput.tsx'
import { ObjInput, useRefGroups } from '../../gt-ref/ObjInput.tsx'
import { PropPathInput } from '../../gt-ref/PropPathInput.tsx'
import { NumberField, patch, Row, TextField } from '../parts.tsx'
import { NOT_FIELDS, type FieldDef } from './registry.ts'

/** 一个字段的控件（按 FieldDef.kind） */
function Control({ def, step, onChange }: { def: FieldDef; step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const v = step[def.k]
  const ph = def.placeholder?.()
  const set = (x: unknown) => onChange(patch(step, def.k, x))
  const withUnit = (el: React.ReactNode) =>
    def.unit ? (
      <div className="ue:flex ue:items-center ue:gap-2">
        {el}
        <span className="ue:text-footnote ue:text-subtle">{def.unit()}</span>
      </div>
    ) : (
      el
    )
  switch (def.kind) {
    case 'number':
      return withUnit(<NumberField step={step} k={def.k} onChange={onChange} placeholder={ph} allowVar />)
    case 'switch':
      return (
        <div className="ue:flex ue:h-8 ue:items-center">
          <Switch checked={v === true} onCheckedChange={(c: boolean) => set(c || undefined)} aria-label={def.label()} />
        </div>
      )
    case 'tri':
      return (
        <ui.Segmented
          size="sm"
          label={def.label()}
          value={v === true ? 'yes' : v === false ? 'no' : ''}
          onChange={(x: string) => set(x === 'yes' ? true : x === 'no' ? false : undefined)}
          options={[
            { id: '', label: t('不管') },
            { id: 'yes', label: t('是') },
            { id: 'no', label: t('否') },
          ]}
        />
      )
    case 'select': {
      const opts = def.options?.() ?? []
      const cur = typeof v === 'string' ? v : ''
      // 文件里写了表里没有的值也照样显示，不悄悄改掉
      const all = cur && !opts.some((o) => o.value === cur) ? [...opts, { value: cur, label: cur }] : opts
      return (
        <ui.Select
          size="sm"
          className="ue:w-full"
          value={cur}
          options={all}
          onChange={(e: { target: { value: string } }) => set(e.target.value || undefined)}
        />
      )
    }
    case 'target':
      return <TargetInput value={v} onChange={(x) => set(x)} />
    case 'obj':
      return <ObjInput value={v as GtRefLike | undefined} onChange={(x) => set(x)} />
    case 'prop':
      return <PropField step={step} k={def.k} onChange={onChange} />
    case 'value':
      return (
        <ValueInput
          value={scalarText(v)}
          placeholder={ph ?? t('值，或 $变量、= 表达式')}
          onChange={(s) => set(s.startsWith('=') || s.startsWith('$') ? s : parseScalar(s))}
        />
      )
    case 'vec': {
      const n = def.dims ?? 2
      const arr = Array.isArray(v) ? (v as unknown[]) : []
      return withUnit(
        <div className="ue:flex ue:min-w-0 ue:gap-1.5">
          {Array.from({ length: n }, (_, i) => (
            <ui.Input
              key={i}
              size="sm"
              className="ue:w-0 ue:min-w-0 ue:flex-1 ue:font-mono"
              placeholder={['x', 'y', 'z'][i]}
              value={arr[i] === undefined ? '' : String(arr[i])}
              onChange={(e: { target: { value: string } }) => {
                const next = Array.from({ length: n }, (_, j) => (j < arr.length ? arr[j] : 0))
                const s = e.target.value.trim()
                const num = Number(s)
                next[i] = s === '' ? 0 : Number.isFinite(num) ? num : s
                set(next)
              }}
            />
          ))}
        </div>,
      )
    }
    default:
      return withUnit(
        <TextField step={step} k={def.k} onChange={onChange} placeholder={ph} mono={def.kind === 'mono'} />,
      )
  }
}

/** 属性路径：下拉来自这一步的对象（step.obj）的属性树，Lua 字段名可搜索，也能直接填 */
function PropField({ step, k, onChange }: { step: GtStep; k: string; onChange: (s: GtStep) => void }) {
  const { groups } = useRefGroups(step.obj as GtRefLike | undefined)
  return (
    <PropPathInput
      value={typeof step[k] === 'string' ? (step[k] as string) : ''}
      groups={groups}
      onChange={(x) => onChange(patch(step, k, x))}
    />
  )
}

/** 按字段表画表单：每个字段一行（Row），when 不成立的不画 */
export function FieldForm({ defs, step, onChange }: { defs: FieldDef[]; step: GtStep; onChange: (s: GtStep) => void }) {
  const shown = defs.filter((d) => !d.when || d.when(step))
  // 字段表里没列、文件里却有的（录制写的轨迹、手写的字段）：只读列出来，不丢
  const known = new Set(defs.map((d) => d.k))
  const extra = Object.keys(step).filter((k) => !known.has(k) && !NOT_FIELDS.has(k))
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      {shown.map((d) => (
        <Row key={d.k} label={d.label()} hint={d.hint?.()}>
          <Control def={d} step={step} onChange={onChange} />
        </Row>
      ))}
      {extra.length > 0 && <ExtraFields keys={extra} step={step} onChange={onChange} />}
    </div>
  )
}

/**
 * 字段表外的字段：简单值（文字、数字、开关）照样给输入框，数组和对象（录制的轨迹、条件）只显示一句「N 项」，
 * 要改到下面「高级：直接改 JSON」里改
 */
export function ExtraFields({ keys, step, onChange }: { keys: string[]; step: GtStep; onChange: (s: GtStep) => void }) {
  return (
    <>
      {keys.map((k) => {
        const v = step[k]
        if (typeof v === 'boolean')
          return (
            <Row key={k} label={k}>
              <Control def={{ k, label: () => k, kind: 'switch' }} step={step} onChange={onChange} />
            </Row>
          )
        if (typeof v === 'number')
          return (
            <Row key={k} label={k}>
              <Control def={{ k, label: () => k, kind: 'number' }} step={step} onChange={onChange} />
            </Row>
          )
        if (typeof v === 'string')
          return (
            <Row key={k} label={k}>
              <Control def={{ k, label: () => k, kind: 'mono' }} step={step} onChange={onChange} />
            </Row>
          )
        const n = Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0
        return (
          <Row key={k} label={k}>
            <span className="ue:block ue:pt-1.5 ue:text-footnote ue:text-subtle">
              {t('{n} 项（录制或手写的）', { n })}
            </span>
          </Row>
        )
      })}
    </>
  )
}
