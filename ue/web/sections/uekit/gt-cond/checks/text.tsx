import type { CondNode } from '../../../../../shared/gt-script/index.ts'
import { h, t } from '../../../../host.ts'
import { TargetInput } from '../TargetInput.tsx'
import { ValueInput } from '../ValueInput.tsx'
import type { CheckKind } from './registry.ts'

/** 控件文字：完全一样（text）/ 包含 / 像（忽略数字标点，textLike）/ 正则 */
const MODES = ['text', 'textContains', 'textLike', 'textMatches'] as const
type Mode = (typeof MODES)[number]
const modeLabel = (m: Mode) =>
  ({ text: t('文字是'), textContains: t('文字包含'), textLike: t('文字像'), textMatches: t('文字匹配正则') })[m]
const modeOf = (c: CondNode) => MODES.find((m) => typeof c[m] === 'string')

function Editor({ value, onChange }: { value: CondNode; onChange: (c: CondNode) => void }) {
  const { ui } = h()
  const m = modeOf(value) ?? 'text'
  const setMode = (next: Mode) => {
    const out: CondNode = { ...value }
    for (const k of MODES) delete out[k]
    out[next] = value[m] ?? ''
    onChange(out)
  }
  return (
    <div className="ue:flex ue:flex-col ue:gap-1.5">
      <TargetInput value={String(value.target ?? '')} onChange={(v) => onChange({ ...value, target: v })} />
      <div className="ue:flex ue:gap-1.5">
        <ui.Select
          size="sm"
          className="ue:w-32 ue:shrink-0"
          value={m}
          onChange={(e: { target: { value: string } }) => setMode(e.target.value as Mode)}
          options={MODES.map((k) => ({ value: k, label: modeLabel(k) }))}
        />
        <ValueInput
          className="ue:min-w-0 ue:flex-1"
          mono={false}
          value={String(value[m] ?? '')}
          onChange={(v) => onChange({ ...value, [m]: v })}
        />
      </div>
    </div>
  )
}

export const textCheck: CheckKind = {
  id: 'text',
  label: () => t('控件文字'),
  hint: () => t('按钮文字是「已领取」、提示里包含某句话'),
  badge: () => t('文字'),
  match: (c) => typeof c.target === 'string' && !!modeOf(c),
  make: () => ({ target: '', text: '' }),
  summary: (c) => {
    const m = modeOf(c)!
    return `${String(c.target ?? '')} ${modeLabel(m)}「${String(c[m])}」`
  },
  Editor,
}
