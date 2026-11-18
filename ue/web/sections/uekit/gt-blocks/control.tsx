import { CircleSlash, CornerDownLeft, OctagonX, StepForward } from 'lucide-react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { condSummary } from '../gt-cond/summary.ts'
import { ValueInput } from '../gt-cond/ValueInput.tsx'
import { scalarText, parseScalar } from '../gt-cond/compare.tsx'
import { Row } from './parts.tsx'
import { registerBlockUi, type InsertItem } from './registry.ts'

/** break / continue / return：可以带条件（cond 成立才做）；return 可以带返回值；fail 带一句话（可用表达式拼） */
function CondOnly({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const has = !!step.cond
  return (
    <div className="ue:flex ue:flex-col ue:gap-2">
      <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-fg">
        <input
          type="checkbox"
          checked={has}
          onChange={(e) => {
            const out = { ...step }
            if (e.target.checked) out.cond = { all: [] }
            else delete out.cond
            onChange(out)
          }}
        />
        {t('只在条件成立时')}
      </label>
      {has && <CondEditor compact value={step.cond} onChange={(c) => onChange({ ...step, cond: c })} />}
      {step.action === 'return' && (
        <Row label={t('返回值')}>
          <ValueInput
            value={scalarText(step.value)}
            onChange={(v) => {
              const out = { ...step }
              if (v === '') delete out.value
              else out.value = parseScalar(v)
              onChange(out)
            }}
          />
        </Row>
      )}
    </div>
  )
}

const when = (s: GtStep) => (s.cond ? t(' · 如果 {c}', { c: condSummary(s.cond) }) : '')

const make = (action: string) => (): GtStep => ({ action })
const ins = (id: string, label: () => string, hint: () => string): InsertItem => ({
  id,
  group: () => t('结束 / 失败'),
  label,
  hint,
  slash: id,
  action: id,
  make: id === 'fail' ? () => ({ action: 'fail', message: '' }) : make(id),
})

registerBlockUi(
  { action: 'break', title: () => t('跳出循环'), icon: CircleSlash, tone: 'danger', summary: (s) => t('跳出循环') + when(s), Inspector: CondOnly },
  [ins('break', () => t('跳出循环'), () => t('出最内层的循环'))],
)
registerBlockUi(
  { action: 'continue', title: () => t('下一轮'), icon: StepForward, tone: 'accent', summary: (s) => t('进下一轮') + when(s), Inspector: CondOnly },
  [ins('continue', () => t('下一轮'), () => t('跳过这一轮剩下的步骤'))],
)
registerBlockUi(
  { action: 'return', title: () => t('结束脚本'), icon: CornerDownLeft, tone: 'subtle', summary: (s) => t('结束脚本') + when(s), Inspector: CondOnly },
  [ins('return', () => t('结束脚本'), () => t('被调用时回到调用处，可以带返回值'))],
)
registerBlockUi(
  {
    action: 'fail',
    title: () => t('失败'),
    icon: OctagonX,
    tone: 'danger',
    summary: (s) => t('失败：{m}', { m: String(s.message ?? '') }),
    Inspector: ({ step, onChange }) => (
      <Row label={t('原因')} hint={t('可以用 = 开头的表达式拼')}>
        <ValueInput mono={false} value={String(step.message ?? '')} onChange={(v) => onChange({ ...step, message: v })} />
      </Row>
    ),
  },
  [ins('fail', () => t('主动失败'), () => t('检查不过时直接让这次运行失败，写清原因'))],
)

