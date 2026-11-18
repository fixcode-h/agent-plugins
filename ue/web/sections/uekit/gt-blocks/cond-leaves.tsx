import { CheckCheck, Hourglass } from 'lucide-react'
import { blockOf, type GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { condSummary } from '../gt-cond/summary.ts'
import { stepTitle } from '../gt-step-title.ts'
import { LeafInspector } from './leaf.tsx'
import { NumberField, Row } from './parts.tsx'
import { registerBlockUi } from './registry.ts'

/**
 * 原有动作里能带统一条件的两个（协议第 2 节）：wait until:"cond"、assert cond。
 * 带条件时用条件组编辑器；录制写出来的老写法（等控件出现、检查文字）照旧按字段改，不强行转
 */
const usesCond = (s: GtStep) => (s.action === 'wait' ? s.until === 'cond' : s.cond !== undefined)

function Inspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  if (!usesCond(step)) return <LeafInspector step={step} onChange={onChange} />
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      {step.action === 'wait' && (
        <Row label={t('最多等')}>
          <div className="ue:flex ue:items-center ue:gap-2">
            <NumberField step={step} k="timeoutMs" onChange={onChange} placeholder="10000" />
            <span className="ue:text-footnote ue:text-subtle">{t('毫秒')}</span>
          </div>
        </Row>
      )}
      <CondEditor value={step.cond} onChange={(c) => onChange({ ...step, cond: c })} />
    </div>
  )
}

registerBlockUi(
  {
    action: 'wait',
    title: () => t('等待'),
    icon: Hourglass,
    tone: 'subtle',
    summary: (s) => (usesCond(s) ? t('等到 {c}', { c: condSummary(s.cond) }) : stepTitle(s)),
    Inspector,
  },
  [
    {
      id: 'wait-cond',
      group: () => t('等待 / 检查'),
      label: () => t('等到条件成立'),
      hint: () => t('界面出现、文字变了、变量到某个值…（条件组）'),
      slash: 'wait',
      action: 'wait',
      make: () => blockOf('wait')!.make(),
    },
    {
      id: 'wait-ms',
      group: () => t('等待 / 检查'),
      label: () => t('等一会儿'),
      hint: () => t('固定等几毫秒，能等条件就别用它'),
      slash: 'sleep',
      action: 'wait',
      make: () => ({ action: 'wait', ms: 1000 }),
    },
  ],
)

registerBlockUi(
  {
    action: 'assert',
    title: () => t('检查'),
    icon: CheckCheck,
    tone: 'success',
    summary: (s) => (usesCond(s) ? t('检查 {c}', { c: condSummary(s.cond) }) : stepTitle(s)),
    Inspector,
  },
  [
    {
      id: 'assert',
      group: () => t('等待 / 检查'),
      label: () => t('检查'),
      hint: () => t('条件不成立这一步就失败'),
      slash: 'assert',
      action: 'assert',
      make: () => ({ action: 'assert', cond: { all: [] } }),
    },
  ],
)
