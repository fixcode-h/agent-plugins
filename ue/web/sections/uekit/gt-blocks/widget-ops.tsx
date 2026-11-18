import { PanelTopClose, SquareMousePointer } from 'lucide-react'
import { blockOf, type GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { TargetInput } from '../gt-cond/TargetInput.tsx'
import { Row, TextField } from './parts.tsx'
import { registerBlockUi } from './registry.ts'

/** 关掉界面 / 调界面上的无参函数（原阻挡界面的两种处理，守护的 do 里最常用） */
function Inspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <Row label={t('界面')}>
        <TargetInput value={String(step.target ?? '')} onChange={(v) => onChange({ ...step, target: v })} />
      </Row>
      {step.action === 'widget.call' && (
        <Row label={t('函数')} hint={t('界面上的无参函数')}>
          <TextField step={step} k="function" mono onChange={onChange} placeholder="OnClickClose" />
        </Row>
      )}
    </div>
  )
}

registerBlockUi(
  {
    action: 'widget.close',
    title: () => t('关掉界面'),
    icon: PanelTopClose,
    tone: 'subtle',
    summary: (s) => t('关掉 {w}', { w: String(s.target ?? '') }),
    Inspector,
  },
  [
    {
      id: 'widget.close',
      group: () => t('界面'),
      label: () => t('关掉界面'),
      hint: () => t('把界面从父级移除（公告、弹窗）'),
      slash: 'close',
      action: 'widget.close',
      make: () => blockOf('widget.close')!.make(),
    },
  ],
)
registerBlockUi(
  {
    action: 'widget.call',
    title: () => t('调界面函数'),
    icon: SquareMousePointer,
    tone: 'subtle',
    summary: (s) => `${String(s.target ?? '')} · ${String(s.function ?? '')}()`,
    Inspector,
  },
  [
    {
      id: 'widget.call',
      group: () => t('界面'),
      label: () => t('调界面函数'),
      hint: () => t('调界面上的无参函数（关闭按钮的处理函数）'),
      slash: 'wcall',
      action: 'widget.call',
      make: () => blockOf('widget.call')!.make(),
    },
  ],
)
