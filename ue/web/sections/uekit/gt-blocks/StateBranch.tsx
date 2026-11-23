import { ArrowDown, ArrowUp, Loader2, Plus, ScanEye, Trash2, Wand2 } from 'lucide-react'
import { useState } from 'react'
import type { GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { openMenu } from '@panel/web/src/components/ui/item-menu'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { TargetInput } from '../gt-cond/TargetInput.tsx'
import { NowBadge } from '../gt-live/NowBar.tsx'
import type { GtTarget } from '../../../../shared/gt-script/ref/types.ts'
import { useCondNow } from '../gt-live/use-cond-now.ts'
import { applyPreset, statePresets, waysOf as ways, withWays, type Way } from './state-presets.ts'

/**
 * 按状态分支（效果图 11）：同一个控件不同状态走不同的路。从上往下判断，走第一条成立的；都不成立走「其余情况」。
 * 每条路一张卡片：条件 + 这条路有几步（步骤在列表 / 流程图里往这条路里放）。连着游戏时一直标出「此刻走这条」
 * （gt.watch 推送；GameTest 1.10.0 以前点「此刻走哪条」问一次）。看哪个控件（对象 + 部件）可以从 Widget 树里抓
 */
export function StateBranch({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui, cn } = h()
  const [target, setTarget] = useState<GtTarget>()
  const list = ways(step)
  const hasElse = Array.isArray(step.else)
  const conds = list.map((w, i) => ({ id: String(i), cond: w.cond ?? { all: [] } }))
  const live = useCondNow(conds)
  // 从上往下第一条成立的；都不成立走「其余情况」，没有其余情况就是 -1（直接往下走）
  const hit = list.findIndex((_, i) => live.byId.get(String(i))?.holds)
  const now = live.byId.size ? (hit >= 0 ? hit : hasElse ? list.length : -1) : undefined

  const set = (next: Way[]) => onChange(withWays(step, next))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    set(next)
  }

  const card = (title: string, i: number, body: React.ReactNode, count: number, tools?: React.ReactNode) => (
    <div
      key={i}
      className={cn(
        'ue:flex ue:flex-col ue:gap-2 ue:rounded-(--c-row-radius) ue:border ue:p-2.5',
        now === i ? 'ue:border-success/70 ue:bg-success/6' : 'ue:border-line ue:bg-card',
      )}
    >
      <div className="ue:flex ue:items-center ue:gap-2">
        <span className="ue:text-footnote ue:font-medium ue:text-fg">{title}</span>
        <span className="ue:text-caption ue:text-subtle">{t('{n} 步', { n: count })}</span>
        {now === i && <span className="ue:text-caption ue:text-success">{t('此刻走这条')}</span>}
        <span className="ue:ml-auto ue:flex ue:items-center">{tools}</span>
      </div>
      {body}
    </div>
  )

  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      <p className="ue:text-footnote ue:text-subtle">
        {t(
          '从上往下判断，走第一条成立的路；都不成立走「其余情况」。反面的路要稳住才走，免得把「还没刷出来」当成「不显示」。',
        )}
      </p>
      <div className="ue:flex ue:items-start ue:gap-1.5">
        <div className="ue:min-w-0 ue:flex-1">
          <TargetInput value={target} onChange={setTarget} />
        </div>
        <ui.Button
          size="sm"
          variant="secondary"
          disabled={!target}
          onClick={(e: React.MouseEvent) =>
            openMenu(
              e,
              statePresets(target!).map((p) => ({
                label: p.label,
                onClick: () => onChange(applyPreset(step, p)),
              })),
            )
          }
        >
          <Wand2 className="ue:h-3.5 ue:w-3.5" />
          {t('一键分路')}
        </ui.Button>
      </div>
      {list.map((w, i) =>
        card(
          t('路 {n}', { n: i + 1 }),
          i,
          <CondEditor
            compact
            value={w.cond}
            onChange={(c) => set(list.map((x, k) => (k === i ? { ...x, cond: c } : x)))}
          />,
          w.then.length,
          <>
            <ui.IconButton size="sm" label={t('往上挪')} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="ue:h-3.5 ue:w-3.5" />
            </ui.IconButton>
            <ui.IconButton size="sm" label={t('往下挪')} disabled={i === list.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown className="ue:h-3.5 ue:w-3.5" />
            </ui.IconButton>
            <ui.IconButton
              size="sm"
              label={t('删掉这条路')}
              disabled={list.length < 2 || w.then.length > 0}
              title={w.then.length ? t('这条路里还有步骤，先挪走或删掉') : undefined}
              onClick={() => set(list.filter((_, k) => k !== i))}
            >
              <Trash2 className="ue:h-3.5 ue:w-3.5" />
            </ui.IconButton>
          </>,
        ),
      )}
      {hasElse &&
        card(
          t('其余情况'),
          list.length,
          <span className="ue:text-footnote ue:text-subtle">{t('上面都不成立（稳住 elseSettleMs 后）走这条')}</span>,
          (step.else as GtStep[]).length,
        )}
      <div className="ue:flex ue:flex-wrap ue:gap-1">
        <ui.Button size="sm" variant="ghost" onClick={() => set([...list, { cond: { all: [] }, then: [] }])}>
          <Plus className="ue:h-3.5 ue:w-3.5" />
          {t('加一条路')}
        </ui.Button>
        {!hasElse && (
          <ui.Button size="sm" variant="ghost" onClick={() => onChange({ ...step, else: [] })}>
            <Plus className="ue:h-3.5 ue:w-3.5" />
            {t('其余情况')}
          </ui.Button>
        )}
        {live.mode === 'manual' && (
          <ui.Button size="sm" variant="ghost" disabled={live.checking} onClick={live.check}>
            {live.checking ? (
              <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
            ) : (
              <ScanEye className="ue:h-3.5 ue:w-3.5" />
            )}
            {t('此刻走哪条')}
          </ui.Button>
        )}
        {live.mode === 'live' && <NowBadge error={live.error} />}
        <ui.Button
          size="sm"
          variant="ghost"
          className="ue:ml-auto"
          onClick={() => {
            const out = { ...step }
            delete out.branch
            onChange(out)
          }}
        >
          {t('画成普通如果')}
        </ui.Button>
      </div>
      {now === -1 && (
        <p className="ue:text-footnote ue:text-warning">{t('此刻哪条路都不成立，也没有「其余情况」：会直接往下走')}</p>
      )}
    </div>
  )
}
