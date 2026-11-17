import { ppost, useAction } from '../../api.ts'
import { h, t } from '../../host.ts'
import { hintOf, isPositional } from './gt-steps.ts'
import type { StepDef } from './GtStepDetail.tsx'

/**
 * 步骤详情「控件」里的「回放怎么认」：按位置写的选择器（容器里第几个）回放时默认先按录制的文字在同容器里找回
 * （GameTest 1.2.4，顺序变了不点错）；就是要点第几个、不管上面写什么的步骤，选「只按第几个」写 hint.byIndex。
 * 改场景文件走 ext/gt/file replace（带原步骤核对，文件被改过就报错让刷新）
 */
export function GtMatchMode(o: {
  project: string
  root: string
  path: string
  index: number
  def: StepDef
  onChanged: () => void
}) {
  const { busy, run } = useAction()
  const hint = hintOf(o.def)
  if (!hint?.text || !isPositional(o.def.target)) return null
  const value = hint.byIndex ? 'index' : 'text'
  const set = (next: 'index' | 'text') =>
    next !== value &&
    run('match', async () => {
      const rest = { ...hint }
      delete rest.byIndex
      const step = { ...o.def, hint: next === 'index' ? { ...rest, byIndex: true } : rest }
      await ppost(o.project, 'ext/gt/file', {
        root: o.root,
        path: o.path,
        action: 'replace',
        index: o.index,
        expect: [o.def],
        steps: [step],
      })
      h().toast.success(next === 'index' ? t('这一步回放只按第几个点') : t('这一步回放先按文字在同容器里找'))
      o.onChanged()
    })
  const { ui } = h()
  return (
    <div className="ue:flex ue:flex-col ue:gap-1">
      <ui.Segmented
        size="sm"
        label={t('回放怎么认')}
        value={value}
        onChange={set}
        options={[
          { id: 'text' as const, label: t('先按文字找'), disabled: !!busy },
          { id: 'index' as const, label: t('只按第几个'), disabled: !!busy },
        ]}
      />
      <p className="ue:text-footnote ue:text-subtle">
        {value === 'index'
          ? t('照选择器里的序号点，不管那个位置上现在写的是什么')
          : t('那个位置上的文字不是「{s}」时，在同一个容器里找文字一样的点；找不到再按序号', { s: hint.text })}
      </p>
    </div>
  )
}
