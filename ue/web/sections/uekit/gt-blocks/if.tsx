import { GitBranch, Plus, Trash2 } from 'lucide-react'
import { blockOf, type GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { condSummary } from '../gt-cond/summary.ts'
import { StateBranch } from './StateBranch.tsx'
import { applyPreset, presetFor } from './state-presets.ts'
import { registerBlockUi } from './registry.ts'

type Elif = { cond?: unknown; then?: GtStep[] }
const elifsOf = (s: GtStep) => (Array.isArray(s.elif) ? (s.elif as Elif[]) : [])

/**
 * 如果 / 否则如果 / 否则。branch: "state" 时画成「按状态分支」（定稿 9.4A）：每条路一张卡片，
 * 存的仍然是 if / elif / else
 */
function IfInspector({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui } = h()
  if (step.branch === 'state') return <StateBranch step={step} onChange={onChange} />
  const elifs = elifsOf(step)
  const setElif = (i: number, e: Elif | undefined) => {
    const next = [...elifs]
    if (e) next[i] = e
    else next.splice(i, 1)
    const out = { ...step, elif: next }
    if (!next.length) delete (out as Record<string, unknown>).elif
    onChange(out)
  }
  return (
    <div className="ue:flex ue:flex-col ue:gap-3">
      <span className="ue:text-footnote ue:font-medium ue:text-fg">{t('如果')}</span>
      <CondEditor
        elseSettle
        value={step.cond}
        onChange={(c) => onChange({ ...step, cond: c })}
        onSplit={(target, kind) => onChange(applyPreset(step, presetFor(target, kind)))}
      />
      {elifs.map((e, i) => (
        <div key={i} className="ue:flex ue:flex-col ue:gap-2 ue:border-t ue:border-line ue:pt-3">
          <div className="ue:flex ue:items-center">
            <span className="ue:text-footnote ue:font-medium ue:text-fg">{t('否则如果 {n}', { n: i + 1 })}</span>
            <ui.IconButton
              size="sm"
              className="ue:ml-auto"
              label={t('删掉这个分支')}
              onClick={() => setElif(i, undefined)}
            >
              <Trash2 className="ue:h-3.5 ue:w-3.5" />
            </ui.IconButton>
          </div>
          <CondEditor compact value={e.cond} onChange={(c) => setElif(i, { ...e, cond: c })} />
        </div>
      ))}
      <div className="ue:flex ue:flex-wrap ue:gap-1 ue:border-t ue:border-line ue:pt-2">
        <ui.Button
          size="sm"
          variant="ghost"
          onClick={() => onChange({ ...step, elif: [...elifs, { cond: { all: [] }, then: [] }] })}
        >
          <Plus className="ue:h-3.5 ue:w-3.5" />
          {t('否则如果')}
        </ui.Button>
        {!Array.isArray(step.else) && (
          <ui.Button size="sm" variant="ghost" onClick={() => onChange({ ...step, else: [] })}>
            <Plus className="ue:h-3.5 ue:w-3.5" />
            {t('否则')}
          </ui.Button>
        )}
        <ui.Button size="sm" variant="ghost" onClick={() => onChange({ ...step, branch: 'state' })}>
          <GitBranch className="ue:h-3.5 ue:w-3.5" />
          {t('画成按状态分支')}
        </ui.Button>
      </div>
    </div>
  )
}

registerBlockUi(
  {
    action: 'if',
    title: () => t('如果'),
    icon: GitBranch,
    tone: 'warning',
    summary: (s) =>
      s.branch === 'state'
        ? t('按状态分支 · {n} 条路', { n: 1 + elifsOf(s).length + (Array.isArray(s.else) ? 1 : 0) })
        : condSummary(s.cond),
    Inspector: IfInspector,
  },
  [
    {
      id: 'if',
      group: () => t('分支'),
      label: () => t('如果'),
      hint: () => t('条件成立走一边，不成立走另一边'),
      slash: 'if',
      action: 'if',
      make: () => ({ ...blockOf('if')!.make(), else: [] }),
    },
    {
      id: 'state',
      group: () => t('分支'),
      label: () => t('按状态分支'),
      hint: () => t('同一个控件不同状态走不同的路：能点就点、显示但不能点就翻页'),
      slash: 'state',
      action: 'if',
      make: () => ({ action: 'if', branch: 'state', cond: { all: [] }, then: [], else: [] }),
    },
  ],
)
