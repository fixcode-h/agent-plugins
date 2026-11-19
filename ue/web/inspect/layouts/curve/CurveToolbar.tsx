import { Trash2 } from 'lucide-react'
import { h, t } from '../../../host.ts'
import { keyPath, type Curve, type CurveKey } from './model.ts'

/**
 * 曲线编辑器的工具条（效果图 B9 中间顶上）：选中关键帧的切线 / 插值（Auto、User、Break 是三次插值的切线模式，Linear、Constant 是插值），
 * 删除选中键。没选键时按钮灰掉
 */
export function CurveToolbar({
  sel,
  busy,
  onSet,
  onRemove,
}: {
  sel?: { c: Curve; k: CurveKey; i: number }
  busy: boolean
  onSet: (writes: { prop: string; value: unknown }[]) => void
  onRemove: () => void
}) {
  const { cn, ui } = h()
  const modes = [
    { id: 'Auto', on: (k: CurveKey) => k.interp === 'cubic' && /auto/i.test(k.tangentMode) },
    { id: 'User', on: (k: CurveKey) => k.interp === 'cubic' && k.tangentMode === 'User' },
    { id: 'Break', on: (k: CurveKey) => k.interp === 'cubic' && k.tangentMode === 'Break' },
    { id: 'Linear', on: (k: CurveKey) => k.interp === 'linear' },
    { id: 'Constant', on: (k: CurveKey) => k.interp === 'constant' },
  ]
  const apply = (id: string) => {
    if (!sel) return
    const p = (f: string) => keyPath(sel.c, sel.i, f)
    if (id === 'Linear' || id === 'Constant') onSet([{ prop: p('InterpMode'), value: `RCIM_${id}` }])
    else
      onSet([
        { prop: p('InterpMode'), value: 'RCIM_Cubic' },
        { prop: p('TangentMode'), value: `RCTM_${id}` },
      ])
  }
  return (
    <div className="ue:flex ue:items-center ue:gap-1">
      <span className="ue:text-caption ue:text-subtle">{t('切线')}</span>
      {modes.map((m) => {
        const on = !!sel && m.on(sel.k)
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={on}
            disabled={!sel || busy}
            onClick={() => apply(m.id)}
            className={cn(
              'ue:h-6 ue:cursor-pointer ue:rounded-md ue:px-2 ue:text-caption ue:transition-colors ue:disabled:cursor-default ue:disabled:opacity-50',
              on ? 'ue:bg-active ue:text-fg' : 'ue:text-muted ue:hover:bg-hover ue:hover:text-fg',
            )}
          >
            {m.id}
          </button>
        )
      })}
      <ui.IconButton icon={Trash2} label={t('删除选中的关键帧')} size="sm" disabled={!sel || busy} onClick={onRemove} />
    </div>
  )
}
