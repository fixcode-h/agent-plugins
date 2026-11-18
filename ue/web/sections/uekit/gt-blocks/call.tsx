import { FileCode2 } from 'lucide-react'
import { blockOf, type GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { ArgsEdit } from '../gt-api/ApiPick.tsx'
import { Row, TextField } from './parts.tsx'
import { registerBlockUi } from './registry.ts'

/** 调用脚本：script 相对场景根（.json 可省），with 传参数，saveAs 存子脚本 return 的值 */
function CallInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <Row label={t('脚本')} hint={t('相对场景根，.json 可省')}>
        <TextField step={step} k="script" mono onChange={onChange} placeholder="common/翻完引导" />
      </Row>
      <Row label={t('参数')}>
        <ArgsEdit
          value={(step.with as Record<string, unknown>) ?? {}}
          onChange={(w) => onChange({ ...step, with: w })}
        />
      </Row>
      <Row label={t('返回值存到')}>
        <TextField step={step} k="saveAs" mono onChange={onChange} placeholder={t('变量名（可不填）')} />
      </Row>
    </div>
  )
}

registerBlockUi(
  {
    action: 'call',
    title: () => t('调用脚本'),
    icon: FileCode2,
    tone: 'run',
    summary: (s) => {
      const w = s.with && typeof s.with === 'object' ? Object.entries(s.with) : []
      return [String(s.script ?? ''), ...w.map(([k, v]) => `${k}=${JSON.stringify(v)}`)].join(' · ')
    },
    Inspector: CallInspector,
  },
  [
    {
      id: 'call',
      group: () => t('结构'),
      label: () => t('调用脚本'),
      hint: () => t('跑另一个脚本，它的守护在调用期间也生效'),
      slash: 'call',
      action: 'call',
      make: () => blockOf('call')!.make(),
    },
  ],
)
