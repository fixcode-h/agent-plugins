import { Variable } from 'lucide-react'
import { blockOf, type GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { scalarText, parseScalar } from '../gt-cond/compare.tsx'
import { ValueInput } from '../gt-cond/ValueInput.tsx'
import { stepTitle } from '../gt-step-title.ts'
import { LeafInspector } from './leaf.tsx'
import { Row, TextField } from './parts.tsx'
import { registerBlockUi } from './registry.ts'

const isWidgetSet = (s: GtStep) => s.var === undefined && s.target !== undefined

/** 设变量：var + value（值、$引用、= 表达式）。没在 vars 里声明的第一次 set 时创建 */
function SetInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  // 同名的旧动作「设置控件的值」（target + value）还按原来的字段改
  if (isWidgetSet(step)) return <LeafInspector step={step} onChange={onChange} />
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <Row label={t('变量')}>
        <TextField step={step} k="var" mono onChange={onChange} placeholder="skipped" />
      </Row>
      <Row label={t('值')} hint={t('= 开头是表达式，例如 =$skipped + 1')}>
        <ValueInput
          value={scalarText(step.value)}
          onChange={(v) => onChange({ ...step, value: parseScalar(v) })}
          placeholder={t('值，或 =表达式')}
        />
      </Row>
    </div>
  )
}

registerBlockUi(
  {
    action: 'set',
    title: () => t('设变量'),
    icon: Variable,
    tone: 'subtle',
    summary: (s) => (isWidgetSet(s) ? stepTitle(s) : `${String(s.var ?? '')} = ${scalarText(s.value)}`),
    Inspector: SetInspector,
  },
  [
    {
      id: 'set',
      group: () => t('数据'),
      label: () => t('设变量'),
      hint: () => t('记一笔：计数、存开始时的金币'),
      slash: 'set',
      action: 'set',
      make: () => blockOf('set')!.make(),
    },
  ],
)
