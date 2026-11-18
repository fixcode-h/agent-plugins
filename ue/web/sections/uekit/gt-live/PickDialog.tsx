import { Code2, GitBranch, Info, Plus, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { CondNode } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { Kbd } from '../../../jump/parts.tsx'
import type { WidgetKind } from '../gt-blocks/state-presets.ts'
import { CompareEdit } from '../gt-cond/compare.tsx'
import { TargetInput } from '../gt-cond/TargetInput.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'
import { FieldGroups, itemKey } from '../gt-vars/FieldGroups.tsx'
import type { VarsReply } from '../gt-vars/model.ts'
import { LiveFrame } from './LiveFrame.tsx'
import {
  fieldCond,
  fieldValues,
  pickWatchItems,
  stateCond,
  stateRows,
  type StateKey,
  type TargetState,
} from './pick-model.ts'
import { PickState } from './PickState.tsx'
import type { CondResolved } from './use-cond-now.ts'
import { useFlash } from './use-flash.ts'
import { usePick } from './use-pick.ts'
import { useLiveWatch, watchIntervalMs } from './use-watch.ts'

type Mode = 'cond' | 'target' | 'object'

/**
 * 从游戏里抓（定稿 9.3、效果图 3 / 10 / 11）：左边是游戏的实时画面，点一下（或在游戏里按住 Ctrl+Alt 点）就选中那个控件；
 * 右边是控件此刻的状态和所在界面的字段（按 C++ / 蓝图 / Lua 分组），每 0.2 秒刷新、变了闪一下。三种用法：
 * - cond：选一行状态或字段拼成判断，「用这个」「加进条件组」，在如果里还能「按它分路」；
 * - target：只要控件的选择器（按状态分支的「看哪个控件」）；
 * - object：要一个类（对象标识），点到游戏画面时是射线打到的 Actor，点到界面时是那个界面
 */
export function PickDialog({
  mode,
  onClose,
  onUse,
  onAdd,
  onSplit,
  onTarget,
  onObject,
}: {
  mode: Mode
  onClose: () => void
  onUse?: (c: CondNode) => void
  onAdd?: (c: CondNode) => void
  onSplit?: (target: string, kind?: WidgetKind) => void
  onTarget?: (target: string, kind?: WidgetKind) => void
  onObject?: (cls: string) => void
}) {
  const { ui } = h()
  const ctx = useEditCtx()
  const pick = usePick(ctx.project, true)
  const p = pick.picked
  const [target, setTarget] = useState('')
  const [sel, setSel] = useState<{ key: string; cond: CondNode }>()
  useEffect(() => {
    if (p?.target) setTarget(p.target)
    setSel(undefined)
  }, [p])

  const items = mode === 'object' ? undefined : pickWatchItems(target.trim(), p, mode === 'cond')
  const watch = useLiveWatch(ctx.project, items)
  const st = (watch.results.state?.results as TargetState[] | undefined)?.[0]
  const checked = (watch.results.checked?.conds as CondResolved[] | undefined)?.[0]?.holds
  const fields = watch.results.fields as (VarsReply & { error?: string }) | undefined
  const same = p?.target === target.trim()
  const kind = same ? p?.kind : undefined
  const rows = stateRows(kind, st, checked)

  const values = useMemo(() => {
    const m = fieldValues(fields?.groups ? fields : undefined)
    for (const r of rows) m.set(`state:${r.id}`, JSON.stringify(r.value ?? null))
    return m
    // rows 由 st、checked 算出
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, st, checked])
  const lit = useFlash(values)

  const cls = p?.actor?.class ?? p?.screenClass ?? p?.widgetClass
  const frameLabel = t('{w} · 实时', { w: p?.via === 'game' ? t('游戏里点的') : 'PIE' })

  const footer = (
    <>
      <span className="ue:mr-auto ue:flex ue:min-w-0 ue:items-center ue:gap-1 ue:text-footnote ue:text-subtle">
        <Info className="ue:h-3.5 ue:w-3.5 ue:shrink-0" />
        <span className="ue:truncate">
          {mode === 'object'
            ? t('只存类和你勾的标识，下次运行按它们重新找')
            : t('字段每 {s} 秒刷新一次，变了会闪一下', { s: watchIntervalMs() / 1000 })}
        </span>
      </span>
      <ui.Button variant="secondary" onClick={onClose}>
        {t('取消')}
      </ui.Button>
      {mode === 'cond' && onSplit && (
        <ui.Button variant="secondary" disabled={!target.trim()} onClick={() => onSplit(target.trim(), kind)}>
          <GitBranch className="ue:h-3.5 ue:w-3.5" />
          {t('按它的状态分路')}
        </ui.Button>
      )}
      {mode === 'cond' && onAdd && (
        <ui.Button variant="secondary" disabled={!sel} onClick={() => sel && onAdd(sel.cond)}>
          <Plus className="ue:h-3.5 ue:w-3.5" />
          {t('加进条件组')}
        </ui.Button>
      )}
      {mode === 'cond' && (
        <ui.Button disabled={!sel} onClick={() => sel && onUse?.(sel.cond)}>
          {t('用这个')}
        </ui.Button>
      )}
      {mode === 'target' && (
        <ui.Button disabled={!target.trim()} onClick={() => onTarget?.(target.trim(), kind)}>
          {t('用这个控件')}
        </ui.Button>
      )}
      {mode === 'object' && (
        <ui.Button disabled={!cls} onClick={() => cls && onObject?.(cls)}>
          {t('用这个类')}
        </ui.Button>
      )}
    </>
  )

  return (
    <ui.Modal
      open
      size="xl"
      onOpenChange={(o: boolean) => !o && onClose()}
      title={mode === 'object' ? t('从游戏里抓一个对象') : t('从游戏里抓控件')}
      description={
        <span className="ue:flex ue:flex-wrap ue:items-center ue:gap-1">
          {t('在游戏里按')} <Kbd>Ctrl</Kbd>+<Kbd>Alt</Kbd> {t('点一下，或直接在下面的画面上点')}
        </span>
      }
      footer={footer}
    >
      {pick.unsupported ? (
        <p className="ue:flex ue:items-center ue:gap-1.5 ue:rounded-(--c-row-radius) ue:bg-warning/8 ue:px-3 ue:py-2 ue:text-footnote ue:text-warning">
          <TriangleAlert className="ue:h-3.5 ue:w-3.5" />
          {t('编辑器里的 GameTest 低于 1.10.0：到「UE 插件」页升级后才能从游戏里抓')}
        </p>
      ) : (
        <div className="ue:grid ue:max-h-[66vh] ue:min-h-0 ue:grid-cols-1 ue:gap-3 ue:overflow-auto ue:lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] ue:lg:overflow-hidden">
          <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-2">
            <LiveFrame
              frame={pick.frame}
              rect={same || mode === 'object' ? p?.rect : undefined}
              label={frameLabel}
              busy={pick.busy}
              error={pick.error}
              onPick={(x, y) => void pick.pickAt(x, y)}
            />
            {pick.recording && (
              <p className="ue:text-caption ue:text-warning">
                {t('正在录制：游戏里的 Ctrl+Alt 点会录成断言，这里只能在画面上点')}
              </p>
            )}
            {mode !== 'object' && (
              <TargetInput value={target} onChange={setTarget} placeholder={t('点一下画面，或写选择器')} />
            )}
            {same && p?.verified === false && (
              <p className="ue:text-caption ue:text-warning">
                {t('这个选择器不唯一或指不回它：同一个界面开了几份时，换成能区分它们的父界面')}
              </p>
            )}
            {p?.targetError && !p.actor && <p className="ue:text-caption ue:text-subtle">{p.targetError}</p>}
            {mode === 'object' && <ObjectInfo picked={p} />}
          </div>
          {mode !== 'object' && (
            <div className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-col ue:overflow-hidden ue:rounded-(--c-row-radius) ue:border ue:border-line">
              {!target.trim() ? (
                <p className="ue:px-4 ue:py-8 ue:text-center ue:text-footnote ue:text-subtle">
                  {t('还没选控件：在左边的画面上点一下')}
                </p>
              ) : (
                <>
                  <PickState
                    widgetClass={same ? p?.widgetClass : st?.class}
                    rows={rows}
                    found={st?.found}
                    lit={lit}
                    selected={sel?.key.startsWith('state:') ? (sel.key.slice(6) as StateKey) : undefined}
                    onSelect={
                      mode === 'cond'
                        ? (id, v) => setSel({ key: `state:${id}`, cond: stateCond(target.trim(), id, v) })
                        : undefined
                    }
                  />
                  {(watch.error || st?.error) && (
                    <p className="ue:px-3 ue:py-1.5 ue:text-caption ue:text-danger">{watch.error || st?.error}</p>
                  )}
                  {mode === 'cond' && same && p?.screen && (
                    <div className="ue:flex ue:min-h-48 ue:flex-1 ue:flex-col ue:border-t ue:border-line">
                      <p className="ue:flex ue:items-center ue:gap-1.5 ue:px-3 ue:py-1.5 ue:text-caption ue:text-subtle">
                        <Code2 className="ue:h-3.5 ue:w-3.5" />
                        {t('所在界面 {w} 的变量 · 每 {s} 秒刷新', {
                          w: p.screenClass ?? p.screen,
                          s: watchIntervalMs() / 1000,
                        })}
                      </p>
                      {fields?.error && <p className="ue:px-3 ue:text-caption ue:text-danger">{fields.error}</p>}
                      <FieldGroups
                        groups={fields?.groups ?? []}
                        showValue
                        lit={lit}
                        selected={new Set(sel && !sel.key.startsWith('state:') ? [sel.key] : [])}
                        onToggle={(g, it) =>
                          fields && setSel({ key: itemKey(g, it), cond: fieldCond(p.screen!, fields, g, it) })
                        }
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {mode === 'cond' && sel && (
            <div className="ue:flex ue:flex-col ue:gap-1.5 ue:lg:col-span-2">
              <CompareEdit value={sel.cond} onChange={(c) => setSel({ ...sel, cond: c })} />
              <code className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
                {JSON.stringify(sel.cond)}
              </code>
            </div>
          )}
        </div>
      )}
    </ui.Modal>
  )
}

/** 抓对象时点到的是什么：Actor（游戏画面）或界面 */
function ObjectInfo({ picked }: { picked?: ReturnType<typeof usePick>['picked'] }) {
  if (!picked) return <p className="ue:text-footnote ue:text-subtle">{t('点画面里的角色、物件，或某个界面')}</p>
  const row = (k: string, v?: string) =>
    v ? (
      <div className="ue:flex ue:items-center ue:gap-3 ue:text-footnote">
        <span className="ue:w-14 ue:shrink-0 ue:text-subtle">{k}</span>
        <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-fg">{v}</span>
      </div>
    ) : null
  if (picked.actor)
    return (
      <div className="ue:flex ue:flex-col ue:gap-1">
        {row(t('类'), picked.actor.class)}
        {row(t('父类'), picked.actor.nativeClass)}
        {row(t('大纲名'), picked.actor.label ?? picked.actor.name)}
      </div>
    )
  return (
    <div className="ue:flex ue:flex-col ue:gap-1">
      {row(t('界面'), picked.screenClass ?? picked.widgetClass)}
      {row(t('控件'), picked.target)}
    </div>
  )
}
