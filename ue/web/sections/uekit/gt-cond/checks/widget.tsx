import type { CondNode } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { TargetInput } from '../TargetInput.tsx'
import type { CheckKind } from './registry.ts'

/** 控件状态：存在 / 可见 / 能点 / 勾上 / 选中，以及界面在不在屏上（onScreen） */
const STATES = ['onScreen', 'exists', 'visible', 'enabled', 'checked', 'selected'] as const
type State = (typeof STATES)[number]

const stateLabel = (s: State, yes: boolean) =>
  ({
    onScreen: yes ? t('在屏上') : t('不在屏上'),
    exists: yes ? t('存在') : t('不存在'),
    visible: yes ? t('可见') : t('不可见'),
    enabled: yes ? t('能点') : t('不能点'),
    checked: yes ? t('勾上') : t('没勾'),
    selected: yes ? t('选中') : t('没选中'),
  })[s]

const stateOf = (c: CondNode) => STATES.find((s) => typeof c[s] === 'boolean')

function Editor({ value, onChange }: { value: CondNode; onChange: (c: CondNode) => void }) {
  const { ui } = h()
  const s = stateOf(value) ?? 'visible'
  const yes = value[s] !== false
  const set = (state: State, v: boolean) => {
    const out: CondNode = { ...value }
    for (const k of STATES) delete out[k]
    out[state] = v
    onChange(out)
  }
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <TargetInput value={String(value.target ?? '')} onChange={(v) => onChange({ ...value, target: v })} />
      <ui.Select
        size="sm"
        value={`${s}:${yes}`}
        onChange={(e: { target: { value: string } }) => {
          const [k, v] = e.target.value.split(':')
          set(k as State, v === 'true')
        }}
        options={STATES.flatMap((k) => [true, false].map((v) => ({ value: `${k}:${v}`, label: stateLabel(k, v) })))}
      />
    </div>
  )
}

export const widgetCheck: CheckKind = {
  id: 'widget',
  label: () => t('控件状态'),
  hint: () => t('界面在不在屏上、控件可见 / 能点 / 勾上'),
  badge: (c) => (c.onScreen !== undefined ? t('界面') : t('控件')),
  match: (c) => typeof c.target === 'string' && !!stateOf(c),
  make: () => ({ target: '', visible: true }),
  summary: (c) => {
    const s = stateOf(c)!
    return `${String(c.target ?? '')} ${stateLabel(s, c[s] !== false)}`
  },
  Editor,
}
