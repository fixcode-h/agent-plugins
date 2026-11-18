import { Plug } from 'lucide-react'
import { blockOf, type GtStep } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { ApiPick, ArgsEdit } from '../gt-api/ApiPick.tsx'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { Row, TextField } from './parts.tsx'
import { registerBlockUi } from './registry.ts'

/** 调接口：接口库里的接口（自带的和项目的），参数按接口给，返回值存变量、可以检查 */
function ApiInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { apis } = useEditCtx()
  const api = apis.find((a) => a.name === step.api)
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <Row label={t('接口')}>
        <ApiPick value={String(step.api ?? '')} onChange={(v) => onChange({ ...step, api: v })} />
      </Row>
      {api?.note && <p className="ue:pl-[80px] ue:text-footnote ue:text-subtle">{api.note}</p>}
      <Row label={t('参数')}>
        <ArgsEdit
          api={api}
          value={(step.args as Record<string, unknown>) ?? {}}
          onChange={(a) => onChange({ ...step, args: a })}
        />
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
    action: 'api',
    title: () => t('接口'),
    icon: Plug,
    tone: 'warning',
    summary: (s) => {
      const args = s.args && typeof s.args === 'object' ? Object.values(s.args).map((v) => JSON.stringify(v)) : []
      return `${String(s.api ?? '')}(${args.join(', ')})${s.saveAs ? ` → $${String(s.saveAs)}` : ''}`
    },
    Inspector: ApiInspector,
  },
  [
    {
      id: 'api',
      group: () => t('调用'),
      label: () => t('调接口'),
      hint: () => t('按类找对象、读写属性、等加载完、看日志报错…'),
      slash: 'api',
      action: 'api',
      make: () => blockOf('api')!.make(),
    },
  ],
)
