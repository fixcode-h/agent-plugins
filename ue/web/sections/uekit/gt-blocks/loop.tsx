import { Repeat } from 'lucide-react'
import { LOOP_MODES, loopModeOf, type GtStep, type LoopMode } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { condSummary } from '../gt-cond/summary.ts'
import { TargetInput } from '../gt-cond/TargetInput.tsx'
import { ValueInput } from '../gt-cond/ValueInput.tsx'
import { NumberField, Row, TextField, patch } from './parts.tsx'
import { registerBlockUi } from './registry.ts'

const modeLabel = (m: LoopMode) =>
  ({
    until: t('直到条件成立'),
    while: t('当条件成立时'),
    times: t('重复 N 次'),
    each: t('对每个条目'),
    in: t('对一组值'),
  })[m]

/** 换循环方式：去掉别的方式的字段，填上这种方式的骨架；max 不写就是不限 */
function setMode(step: GtStep, m: LoopMode): GtStep {
  const out: GtStep = { ...step }
  for (const k of LOOP_MODES) delete out[k]
  delete out.as
  if (m === 'until' || m === 'while') out[m] = { all: [] }
  if (m === 'times') out.times = 3
  if (m === 'each') out.each = ''
  if (m === 'in') out.in = []
  if (m === 'times') {
    delete out.max
    delete out.onMax
  }
  return out
}

function LoopInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  const m = loopModeOf(step) ?? 'until'
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <ui.Segmented
        size="sm"
        label={t('循环方式')}
        value={m}
        onChange={(v: LoopMode) => onChange(setMode(step, v))}
        options={LOOP_MODES.map((x) => ({ id: x, label: modeLabel(x) }))}
      />
      {(m === 'until' || m === 'while') && (
        <CondEditor elseSettle={m === 'while'} value={step[m]} onChange={(c) => onChange({ ...step, [m]: c })} />
      )}
      {m === 'times' && (
        <Row label={t('次数')}>
          <NumberField step={step} k="times" allowVar onChange={onChange} placeholder="3" />
        </Row>
      )}
      {m === 'each' && (
        <>
          <Row label={t('容器')} hint={t('列表、格子；没滚到的条目会自动滚出来')}>
            <TargetInput value={String(step.each ?? '')} onChange={(v) => onChange({ ...step, each: v })} />
          </Row>
          <Row label={t('条目叫')}>
            <TextField step={step} k="as" mono onChange={onChange} placeholder="item" />
          </Row>
        </>
      )}
      {m === 'in' && (
        <>
          <Row label={t('一组值')} hint={t('JSON 数组，或 $变量、= 表达式')}>
            <ValueInput
              value={typeof step.in === 'string' ? step.in : JSON.stringify(step.in ?? [])}
              onChange={(v) => {
                try {
                  onChange({ ...step, in: v.startsWith('$') || v.startsWith('=') ? v : (JSON.parse(v) as unknown) })
                } catch {
                  onChange({ ...step, in: v })
                }
              }}
            />
          </Row>
          <Row label={t('每个叫')}>
            <TextField step={step} k="as" mono onChange={onChange} placeholder="item" />
          </Row>
        </>
      )}
      {m !== 'times' && (
        <Row label={t('最多')} hint={t('跑几轮还没结束就停；0 或不填 = 不限，不限时可以在下面「总时限」兜底')}>
          <div className="ue:flex ue:items-center ue:gap-2">
            <NumberField step={step} k="max" onChange={onChange} placeholder="0" />
            <span className="ue:text-footnote ue:text-subtle">{t('次（0 = 不限）')}</span>
          </div>
        </Row>
      )}
      <Row label={t('每轮间隔')}>
        <div className="ue:flex ue:items-center ue:gap-2">
          <NumberField step={step} k="gapMs" onChange={onChange} placeholder="0" />
          <span className="ue:text-footnote ue:text-subtle">{t('毫秒')}</span>
        </div>
      </Row>
      {m !== 'times' && typeof step.max === 'number' && step.max > 0 && (
        <Row label={t('到了上限')}>
          <ui.Segmented
            size="sm"
            label={t('到了上限')}
            value={step.onMax === 'continue' ? 'continue' : 'fail'}
            onChange={(v: string) => onChange(patch(step, 'onMax', v === 'fail' ? undefined : v))}
            options={[
              { id: 'fail', label: t('算失败') },
              { id: 'continue', label: t('接着往下') },
            ]}
          />
        </Row>
      )}
    </div>
  )
}

function loopSummary(s: GtStep) {
  const m = loopModeOf(s)
  const max = typeof s.max === 'number' && s.max > 0 ? t(' · 最多 {n} 次', { n: s.max }) : ''
  switch (m) {
    case 'until':
      return t('直到 {c}', { c: condSummary(s.until) }) + max
    case 'while':
      return t('当 {c}', { c: condSummary(s.while) }) + max
    case 'times':
      return t('重复 {n} 次', { n: String(s.times) })
    case 'each':
      return t('对 {c} 的每个条目 {a}', { c: String(s.each), a: String(s.as ?? 'item') }) + max
    case 'in':
      return (
        t('对 {c} 里的每个 {a}', {
          c: typeof s.in === 'string' ? s.in : JSON.stringify(s.in),
          a: String(s.as ?? 'item'),
        }) + max
      )
    default:
      return t('循环（没写方式）')
  }
}

const item = (id: LoopMode, label: () => string, hint: () => string) => ({
  id: `loop-${id}`,
  group: () => t('循环'),
  label,
  hint,
  slash: id === 'times' ? 'repeat' : id,
  action: 'loop',
  make: () => setMode({ action: 'loop', do: [] }, id),
})

registerBlockUi(
  {
    action: 'loop',
    title: () => t('循环'),
    icon: Repeat,
    tone: 'accent',
    summary: loopSummary,
    Inspector: LoopInspector,
  },
  [
    item(
      'until',
      () => t('直到条件成立'),
      () => t('每次做完里面的步骤看一次条件，成立就出来（翻引导、等加载）'),
    ),
    item(
      'times',
      () => t('重复 N 次'),
      () => t('固定次数，也可以写 $变量'),
    ),
    item(
      'each',
      () => t('对每个条目'),
      () => t('列表、格子里每一格做一遍，条目叫 item'),
    ),
    item(
      'while',
      () => t('当条件成立时'),
      () => t('每轮开始前看条件，不成立就出来'),
    ),
    item(
      'in',
      () => t('对一组值'),
      () => t('对一组账号、数量各做一遍'),
    ),
  ],
)
