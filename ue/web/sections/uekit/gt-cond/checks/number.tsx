import type { CondNode } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { TargetInput } from '../TargetInput.tsx'
import { parseScalar, scalarText } from '../compare.tsx'
import type { CheckKind } from './registry.ts'

/** 文字里的数字（「剩 2 次」→ 2、「1,200」→ 1200）：number: {eq/ne/gt/gte/lt/lte/between} */
const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between'] as const
type Op = (typeof OPS)[number]
const opLabel = (o: Op) => ({ eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', between: t('在…之间') })[o]

const numOf = (c: CondNode) => (c.number && typeof c.number === 'object' ? (c.number as Record<string, unknown>) : {})
const opOf = (c: CondNode): Op => OPS.find((o) => o in numOf(c)) ?? 'gte'

function Editor({ value, onChange }: { value: CondNode; onChange: (c: CondNode) => void }) {
  const { ui } = h()
  const op = opOf(value)
  const v = numOf(value)[op]
  const set = (o: Op, raw: string) =>
    onChange({
      ...value,
      number: { [o]: o === 'between' ? raw.split(',').map((x) => parseScalar(x.trim())) : parseScalar(raw) },
    })
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <TargetInput value={String(value.target ?? '')} onChange={(x) => onChange({ ...value, target: x })} />
      <div className="ue:flex ue:gap-1.5">
        <ui.Select
          size="sm"
          className="ue:w-28 ue:shrink-0"
          value={op}
          onChange={(e: { target: { value: string } }) => set(e.target.value as Op, scalarText(v))}
          options={OPS.map((o) => ({ value: o, label: opLabel(o) }))}
        />
        <ui.Input
          size="sm"
          className="ue:min-w-0 ue:flex-1 ue:font-mono"
          placeholder={op === 'between' ? t('两个数，逗号隔开') : t('数字，或 $变量')}
          value={scalarText(v)}
          onChange={(e: { target: { value: string } }) => set(op, e.target.value)}
        />
      </div>
    </div>
  )
}

export const numberCheck: CheckKind = {
  id: 'number',
  label: () => t('文字里的数字'),
  hint: () => t('「剩 2 次」按 2 比，「1,200」按 1200 比'),
  badge: () => t('数字'),
  match: (c) => typeof c.target === 'string' && !!c.number && typeof c.number === 'object',
  make: () => ({ target: '', number: { gte: 1 } }),
  summary: (c) => {
    const o = opOf(c)
    return `${String(c.target ?? '')} ${t('数字')} ${opLabel(o)} ${scalarText(numOf(c)[o])}`
  },
  Editor,
}
