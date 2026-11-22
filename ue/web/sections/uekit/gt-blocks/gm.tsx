import { Wand2 } from 'lucide-react'
import { blockOf, type GtStep } from '../../../../shared/gt-script/index.ts'
import type { GmRef } from '../../../../shared/gt-script/gm/expand.ts'
import { t } from '../../../host.ts'
import { refText } from '../gt-gm/gm-ref.ts'
import { GmRefEditor } from '../gt-gm/GmRefEditor.tsx'
import { Row, TextField } from './parts.tsx'
import { blockUi, registerBlockUi } from './registry.ts'

/**
 * 执行 GM（GameTest 2.3.0 的 gm.run，测试页梳理 G6）：存的是「哪条 GM + 参数」，
 * 真正跑的步骤（run）由面板在存盘、运行前按 GM 库展开写进去，这里只读着给人看「会执行」什么
 */
function GmInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const gm = (step.gm ?? { kind: 'custom', name: '' }) as GmRef
  const run = Array.isArray(step.run) ? (step.run as GtStep[]) : []
  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <GmRefEditor value={gm} onChange={(v) => onChange({ ...step, gm: v })} />
      <Row label={t('返回值存到')}>
        <TextField step={step} k="saveAs" mono onChange={onChange} placeholder={t('变量名（可不填）')} />
      </Row>
      <div className="ue:flex ue:flex-col ue:gap-1">
        <span className="ue:text-footnote ue:text-subtle">{t('会执行（存盘时按 GM 库生成，不用手改）')}</span>
        {run.length ? (
          <ol className="ue:flex ue:flex-col ue:gap-0.5 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card ue:px-2.5 ue:py-1.5">
            {run.map((s, i) => {
              const ui = blockUi(String(s.action ?? ''))
              return (
                <li key={i} className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-caption">
                  <ui.icon className="ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
                  <span className="ue:shrink-0 ue:text-muted">{ui.title()}</span>
                  <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg">{ui.summary(s)}</span>
                </li>
              )
            })}
          </ol>
        ) : (
          <span className="ue:text-caption ue:text-subtle">{t('还没生成：存盘后出现')}</span>
        )}
      </div>
    </div>
  )
}

registerBlockUi(
  {
    action: 'gm.run',
    title: () => t('执行 GM'),
    icon: Wand2,
    tone: 'run',
    summary: (s) => `${refText(s.gm as GmRef | undefined)}${s.saveAs ? ` → $${String(s.saveAs)}` : ''}`,
    Inspector: GmInspector,
  },
  [
    {
      id: 'gm.run',
      group: () => t('调用'),
      label: () => t('执行 GM'),
      hint: () => t('调 GM 页的 GM、自定义 GM 或宏，参数可以用变量'),
      slash: 'gm',
      action: 'gm.run',
      make: () => blockOf('gm.run')!.make(),
    },
  ],
)
