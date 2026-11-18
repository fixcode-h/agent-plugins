import { SquareFunction } from 'lucide-react'
import { blockOf, type GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { ArgsEdit } from '../gt-api/ApiPick.tsx'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { Row, TextField } from './parts.tsx'
import { registerBlockUi } from './registry.ts'

/**
 * 调函数（协议第 6 节）：object 是取值来源（@sub.X、$var、{"$obj": 名字}…），省略时 function 写成「类名.函数」调静态函数。
 * 参数只用能自己构造的值和抓取的对象；expect 是对返回值的统一条件
 */
function InvokeInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const obj = step.object
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <Row label={t('对象')} hint={t('@sub.UQuestSubsystem、$npc、@luaMod.路径；调静态函数时不填')}>
        {obj && typeof obj === 'object' ? (
          <code className="ue:font-mono ue:text-footnote ue:text-fg">{JSON.stringify(obj)}</code>
        ) : (
          <TextField step={step} k="object" mono onChange={onChange} placeholder="@sub.UQuestSubsystem" />
        )}
      </Row>
      <Row label={t('函数')}>
        <TextField step={step} k="function" mono onChange={onChange} placeholder="AcceptQuest" />
      </Row>
      <Row label={t('参数')}>
        <ArgsEdit value={(step.args as Record<string, unknown>) ?? {}} onChange={(a) => onChange({ ...step, args: a })} />
      </Row>
      <Row label={t('返回值存到')}>
        <TextField step={step} k="saveAs" mono onChange={onChange} placeholder={t('变量名（可不填）')} />
      </Row>
      <span className="ue:text-footnote ue:text-subtle">{t('返回值要满足（不写就不检查）')}</span>
      <CondEditor compact value={step.expect} onChange={(c) => onChange({ ...step, expect: c })} />
    </div>
  )
}

registerBlockUi(
  {
    action: 'invoke',
    title: () => t('调函数'),
    icon: SquareFunction,
    tone: 'warning',
    summary: (s) => {
      const obj = typeof s.object === 'string' ? `${s.object}.` : s.object ? `${JSON.stringify(s.object)}.` : ''
      const args = s.args && typeof s.args === 'object' ? Object.values(s.args).map((v) => JSON.stringify(v)) : []
      return `${obj}${String(s.function ?? '')}(${args.join(', ')})${s.saveAs ? ` → $${String(s.saveAs)}` : ''}`
    },
    Inspector: InvokeInspector,
  },
  [
    {
      id: 'invoke',
      group: () => t('调用'),
      label: () => t('调函数'),
      hint: () => t('C++、蓝图可调用、Exec、Lua 函数：准备状态、直接接任务'),
      slash: 'invoke',
      action: 'invoke',
      make: () => blockOf('invoke')!.make(),
    },
  ],
)
