import { Play } from 'lucide-react'
import { getAt, replace, type GtPath, type GtScript, type GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { blockUi, CommonFields, TONE_TEXT } from '../gt-blocks/index.ts'
import { canRun, COMMANDS, type CmdCtx } from './commands.ts'

/**
 * 右栏检查器：选中一步时上面是这种块自己的字段（块 UI 注册表的 Inspector），下面是所有步骤共用的字段；
 * 选中多步时只给批量命令（包成段、停用、删）。什么都没选时外壳显示脚本设置
 */
export function Inspector({
  doc,
  selected,
  onChange,
  ctx,
  onTry,
}: {
  doc: GtScript
  selected: GtPath[]
  onChange: (r: ReturnType<typeof replace> | GtScript | undefined) => boolean
  ctx: CmdCtx
  onTry?: (p: GtPath) => void
}) {
  const { ui, cn } = h()
  if (selected.length > 1)
    return (
      <div className="ue:flex ue:flex-col ue:gap-2 ue:p-4">
        <p className="ue:text-footnote ue:text-fg">{t('选了 {n} 步', { n: selected.length })}</p>
        <div className="ue:flex ue:flex-wrap ue:gap-1.5">
          {COMMANDS.filter((c) => c.multi && canRun(c, ctx)).map((c) => (
            <ui.Button key={c.id} size="sm" variant={c.danger ? 'danger-outline' : 'secondary'} onClick={() => c.run(ctx)}>
              <c.icon className="ue:h-3.5 ue:w-3.5" />
              {c.label()}
            </ui.Button>
          ))}
        </div>
        <p className="ue:text-caption ue:text-subtle">{t('Ctrl 点选加减，Shift 点选连选；包成块要选同一层的步骤')}</p>
      </div>
    )
  const path = selected[0]
  const step = path && (getAt(doc, path) as GtStep | undefined)
  if (!path || !step) return null
  const bu = blockUi(step.action)
  const set = (s: GtStep) => onChange(replace(doc, path, s))
  const Own = bu.Inspector
  return (
    <div className="ue:flex ue:flex-col ue:gap-4 ue:p-4">
      <div className="ue:flex ue:items-center ue:gap-2">
        <bu.icon className={cn('ue:h-4 ue:w-4 ue:shrink-0', TONE_TEXT[bu.tone])} />
        <span className="ue:text-body ue:font-medium ue:text-fg">{bu.title()}</span>
        <code className="ue:font-mono ue:text-caption ue:text-subtle">{typeof step.id === 'string' ? step.id : ''}</code>
        {onTry && (
          <ui.Button size="sm" variant="secondary" className="ue:ml-auto" onClick={() => onTry(path)}>
            <Play className="ue:h-3.5 ue:w-3.5" />
            {t('试这一步')}
          </ui.Button>
        )}
      </div>
      {Own && <Own key={typeof step.id === 'string' ? step.id : path.join('.')} step={step} onChange={set} />}
      <div className="ue:border-t ue:border-line ue:pt-3">
        <CommonFields step={step} onChange={set} />
      </div>
    </div>
  )
}
