import { Layers } from 'lucide-react'
import { blockOf } from '../../../../shared/gt-script/index.ts'
import { t } from '../../../host.ts'
import { Row, TextField } from './parts.tsx'
import { registerBlockUi } from './registry.ts'

/** 步骤段：录制录出来的就是一段（recorded），可以折叠 */
registerBlockUi(
  {
    action: 'group',
    title: () => t('段'),
    icon: Layers,
    tone: 'subtle',
    summary: (s) => {
      const n = Array.isArray(s.do) ? s.do.length : 0
      const name = typeof s.name === 'string' && s.name ? s.name : s.recorded ? t('录制') : t('步骤段')
      return t('{name} · {n} 步', { name, n })
    },
    Inspector: ({ step, onChange }) => (
      <Row label={t('名字')}>
        <TextField step={step} k="name" onChange={onChange} placeholder={t('打开福利')} />
      </Row>
    ),
  },
  [
    {
      id: 'group',
      group: () => t('结构'),
      label: () => t('步骤段'),
      hint: () => t('把几步收成一段，可以折叠'),
      slash: 'group',
      action: 'group',
      make: () => blockOf('group')!.make(),
    },
  ],
)
