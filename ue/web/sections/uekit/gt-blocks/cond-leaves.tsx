import { CheckCheck, Hourglass } from 'lucide-react'
import { blockOf, type GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { condSummary } from '../gt-cond/summary.ts'
import { stepTitle } from '../gt-step-title.ts'
import { WAIT_MODES } from './fields/actions.ts'
import { LeafInspector } from './leaf.tsx'
import { NumberField, Row } from './parts.tsx'
import { registerBlockUi } from './registry.ts'

/**
 * 原有动作里能带统一条件的两个（协议第 2 节）：wait until:"cond"、assert cond。
 * 带条件时用条件组编辑器；录制写出来的老写法（等控件出现、检查文字）照旧按字段改，不强行转
 */
const usesCond = (s: GtStep) => (s.action === 'wait' ? s.until === 'cond' : s.cond !== undefined)

/** 老写法 {ms} 换成协议认的 until:"seconds"（GameTest 的 wait 必须写 until） */
function normWait(s: GtStep): GtStep {
  if (s.until !== undefined || s.ms === undefined) return s
  const { ms, ...rest } = s
  return { ...rest, until: 'seconds', seconds: typeof ms === 'number' ? ms / 1000 : ms }
}

/** 换等待方式：去掉旧方式的字段，cond 给一个空条件组 */
function switchWait(step: GtStep, mode: string): GtStep {
  const keep: GtStep = { action: 'wait' }
  for (const k of [
    'id',
    'title',
    'note',
    'onFail',
    'retries',
    'timeoutMs',
    'skipIf',
    'expectNoErrors',
    'disabled',
    'hint',
  ])
    if (k in step) keep[k] = step[k]
  if (mode === 'cond') return { ...keep, until: 'cond', cond: { all: [] } }
  if (mode === 'seconds') return { ...keep, until: 'seconds', seconds: 1 }
  return { ...keep, until: mode }
}

function WaitMode({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const cur = typeof step.until === 'string' ? step.until : 'seconds'
  return (
    <Row label={t('等待方式')}>
      <ui.Select
        size="sm"
        className="ue:w-full"
        value={cur}
        options={WAIT_MODES()}
        onChange={(e: { target: { value: string } }) => onChange(switchWait(step, e.target.value))}
      />
    </Row>
  )
}

function Inspector({ step: raw, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const step = raw.action === 'wait' ? normWait(raw) : raw
  if (!usesCond(step))
    return (
      <div className="ue:flex ue:flex-col ue:gap-2.5">
        {step.action === 'wait' && <WaitMode step={step} onChange={onChange} />}
        <LeafInspector step={step} onChange={onChange} />
      </div>
    )
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      {step.action === 'wait' && <WaitMode step={step} onChange={onChange} />}
      {/* 最多等多久就是下面「出错和跳过」的总时限（同一个 timeoutMs），这里不再重复一份 */}
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
      hint: () => t('固定等几秒，能等条件就别用它'),
      slash: 'sleep',
      action: 'wait',
      make: () => ({ action: 'wait', until: 'seconds', seconds: 1 }),
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
