import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { openMenu } from '@panel/web/src/components/ui/item-menu'
import { blockUi, TONE_TEXT } from '../gt-blocks/index.ts'
import { insertMenuItems } from './insert-menu.ts'

/**
 * 小步骤列表：守护的 do、脚本设置里这类「几步就够」的地方用。每步一行（图标 + 一句话），点开就地改（块 UI 的检查器）。
 * 步骤多、要分支循环的写成一个脚本，这里 call 它
 */
export function StepsMini({ value, onChange }: { value: GtStep[]; onChange: (v: GtStep[]) => void }) {
  const { ui, cn } = h()
  const [open, setOpen] = useState<number>()
  const set = (i: number, s: GtStep) => onChange(value.map((x, k) => (k === i ? s : x)))
  const swap = (i: number, j: number) => {
    const next = [...value]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
    setOpen(open === i ? j : open)
  }
  return (
    <div className="ue:flex ue:flex-col ue:rounded-(--c-row-radius) ue:border ue:border-line">
      {value.map((s, i) => {
        const bu = blockUi(s.action)
        const Own = bu.Inspector
        return (
          <div key={i} className={cn(i > 0 && 'ue:border-t ue:border-line/60')}>
            <div className="ue:group ue:flex ue:h-8 ue:items-center ue:gap-2 ue:px-2 ue:text-footnote">
              <button
                type="button"
                className="ue:flex ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:items-center ue:gap-2 ue:text-left"
                onClick={() => setOpen(open === i ? undefined : i)}
              >
                {open === i ? (
                  <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                ) : (
                  <ChevronRight className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
                )}
                <bu.icon className={cn('ue:h-3.5 ue:w-3.5 ue:shrink-0', TONE_TEXT[bu.tone])} />
                <span className="ue:min-w-0 ue:truncate ue:text-fg">{bu.summary(s) || bu.title()}</span>
              </button>
              <ui.IconButton size="sm" label={t('往上挪')} disabled={i === 0} onClick={() => swap(i, i - 1)}>
                <ArrowUp className="ue:h-3.5 ue:w-3.5" />
              </ui.IconButton>
              <ui.IconButton
                size="sm"
                label={t('往下挪')}
                disabled={i === value.length - 1}
                onClick={() => swap(i, i + 1)}
              >
                <ArrowDown className="ue:h-3.5 ue:w-3.5" />
              </ui.IconButton>
              <ui.IconButton
                size="sm"
                label={t('删掉')}
                onClick={() => {
                  onChange(value.filter((_, k) => k !== i))
                  setOpen(undefined)
                }}
              >
                <Trash2 className="ue:h-3.5 ue:w-3.5" />
              </ui.IconButton>
            </div>
            {open === i && Own && (
              <div className="ue:border-t ue:border-line/60 ue:bg-panel/50 ue:p-2.5">
                <Own step={s} onChange={(n) => set(i, n)} />
              </div>
            )}
          </div>
        )
      })}
      <button
        type="button"
        className={cn(
          'ue:flex ue:h-8 ue:cursor-pointer ue:items-center ue:gap-1 ue:px-2 ue:text-caption ue:text-subtle ue:hover:text-fg',
          value.length > 0 && 'ue:border-t ue:border-line/60',
        )}
        onClick={(e) =>
          openMenu(
            e,
            insertMenuItems((it) => {
              onChange([...value, it.make()])
              setOpen(value.length)
            }),
          )
        }
      >
        <Plus className="ue:h-3 ue:w-3" />
        {t('加一步')}
      </button>
    </div>
  )
}
