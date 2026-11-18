import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { GtGuard, GtStep } from '../../../../shared/gt-script/index.ts'
import { h, t } from '../../../host.ts'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { condSummary } from '../gt-cond/summary.ts'
import { StepsMini } from '../gt-edit/StepsMini.tsx'

/**
 * 守护列表（定稿 9.6、效果图 7）：全局设置页和脚本设置共用。每条一张卡片：收起时一行「当 … 就 …」，
 * 展开改条件（条件组编辑器）、做什么（小步骤列表）和几项触发规则。顺序就是同时成立时的处理顺序
 */
export function GuardList({ value, onChange }: { value: GtGuard[]; onChange: (v: GtGuard[]) => void }) {
  const [open, setOpen] = useState<string>()
  const keyOf = (g: GtGuard, i: number) => g.id ?? String(i)
  const set = (i: number, g: GtGuard) => onChange(value.map((x, k) => (k === i ? g : x)))
  const swap = (i: number, j: number) => {
    const next = [...value]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="ue:flex ue:flex-col ue:gap-2">
      {value.map((g, i) => (
        <GuardCard
          key={keyOf(g, i)}
          guard={g}
          open={open === keyOf(g, i)}
          onToggle={() => setOpen(open === keyOf(g, i) ? undefined : keyOf(g, i))}
          onChange={(n) => set(i, n)}
          onRemove={() => onChange(value.filter((_, k) => k !== i))}
          onUp={i > 0 ? () => swap(i, i - 1) : undefined}
          onDown={i < value.length - 1 ? () => swap(i, i + 1) : undefined}
        />
      ))}
    </div>
  )
}

function GuardCard({
  guard: g,
  open,
  onToggle,
  onChange,
  onRemove,
  onUp,
  onDown,
}: {
  guard: GtGuard
  open: boolean
  onToggle: () => void
  onChange: (g: GtGuard) => void
  onRemove: () => void
  onUp?: () => void
  onDown?: () => void
}) {
  const { ui, cn } = h()
  const steps = (g.do ?? []) as GtStep[]
  const setField = (k: string, v: unknown) => {
    const out = { ...g }
    if (v === undefined) delete out[k]
    else out[k] = v
    onChange(out)
  }
  const num = (k: string, def: number) => (
    <ui.Input
      size="sm"
      className="ue:w-24 ue:font-mono"
      placeholder={String(def)}
      value={g[k] === undefined ? '' : String(g[k])}
      onChange={(e: { target: { value: string } }) => {
        const s = e.target.value.trim()
        if (!s) return setField(k, undefined)
        const n = Number(s)
        if (Number.isFinite(n) && n >= 0) setField(k, Math.round(n))
      }}
    />
  )
  const label = 'ue:w-24 ue:shrink-0 ue:text-footnote ue:text-subtle'
  return (
    <div
      className={cn(
        'ue:flex ue:flex-col ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-card',
        g.disabled === true && 'ue:opacity-60',
      )}
    >
      <div className="ue:flex ue:min-h-9 ue:items-center ue:gap-2 ue:px-2.5">
        <button
          type="button"
          className="ue:flex ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:items-center ue:gap-2 ue:text-left"
          onClick={onToggle}
        >
          {open ? (
            <ChevronDown className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
          ) : (
            <ChevronRight className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
          )}
          <ShieldCheck className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent" />
          <span className="ue:shrink-0 ue:text-footnote ue:font-medium ue:text-fg">{g.name || g.id || t('守护')}</span>
          <span className="ue:min-w-0 ue:truncate ue:text-footnote ue:text-subtle">
            {t('当 {c} 就做 {n} 步', { c: g.when === undefined ? '…' : condSummary(g.when), n: steps.length })}
          </span>
        </button>
        <label className="ue:flex ue:shrink-0 ue:cursor-pointer ue:items-center ue:gap-1 ue:text-caption ue:text-fg">
          <input
            type="checkbox"
            className="ue:accent-(--accent)"
            checked={g.disabled !== true}
            onChange={(e) => setField('disabled', e.target.checked ? undefined : true)}
          />
          {t('启用')}
        </label>
        <ui.IconButton icon={ArrowUp} size="xs" label={t('往上挪（先处理）')} disabled={!onUp} onClick={onUp} />
        <ui.IconButton icon={ArrowDown} size="xs" label={t('往下挪')} disabled={!onDown} onClick={onDown} />
        <ui.IconButton icon={Trash2} size="xs" label={t('删掉这条守护')} onClick={onRemove} />
      </div>
      {open && (
        <div className="ue:flex ue:flex-col ue:gap-3 ue:border-t ue:border-line ue:p-3">
          <div className="ue:flex ue:items-center ue:gap-2">
            <span className={label}>{t('名字')}</span>
            <ui.Input
              size="sm"
              className="ue:min-w-0 ue:flex-1"
              placeholder={t('报告里显示，例如 新手引导出现')}
              value={typeof g.name === 'string' ? g.name : ''}
              onChange={(e: { target: { value: string } }) => setField('name', e.target.value || undefined)}
            />
          </div>
          <div className="ue:flex ue:flex-col ue:gap-1.5">
            <span className="ue:text-footnote ue:text-subtle">{t('当这个成立')}</span>
            <CondEditor value={g.when} onChange={(c) => setField('when', c)} />
          </div>
          <div className="ue:flex ue:flex-col ue:gap-1.5">
            <span className="ue:text-footnote ue:text-subtle">
              {t('就做（步骤多、要分支的写成脚本，这里「调用脚本」）')}
            </span>
            <StepsMini value={steps} onChange={(v) => setField('do', v)} />
          </div>
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
            <span className={label}>{t('什么时候看')}</span>
            <ui.Segmented
              size="sm"
              label={t('什么时候看')}
              value={(g.check as string) ?? 'both'}
              onChange={(v: string) => setField('check', v === 'both' ? undefined : v)}
              options={[
                { id: 'both', label: t('都看') },
                { id: 'beforeStep', label: t('每步开始前') },
                { id: 'whileWaiting', label: t('等待中') },
              ]}
            />
          </div>
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
            <span className={label}>{t('处理完')}</span>
            <ui.Segmented
              size="sm"
              label={t('处理完')}
              value={(g.after as string) ?? 'retry'}
              onChange={(v: string) => setField('after', v === 'retry' ? undefined : v)}
              options={[
                { id: 'retry', label: t('重做被打断的那步') },
                { id: 'skip', label: t('那步算跳过') },
                { id: 'fail', label: t('算失败') },
              ]}
            />
          </div>
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
            <span className={label}>{t('做的步骤失败')}</span>
            <ui.Segmented
              size="sm"
              label={t('做的步骤失败')}
              value={(g.onFail as string) ?? 'stop'}
              onChange={(v: string) => setField('onFail', v === 'stop' ? undefined : v)}
              options={[
                { id: 'stop', label: t('整次运行失败') },
                { id: 'ignore', label: t('记警告继续') },
              ]}
            />
          </div>
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
            <span className={label}>{t('最多触发')}</span>
            {num('max', 20)}
            <span className="ue:text-footnote ue:text-subtle">{t('次，间隔至少')}</span>
            {num('cooldownMs', 1000)}
            <span className="ue:text-footnote ue:text-subtle">{t('毫秒')}</span>
          </div>
          <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-1.5 ue:text-footnote ue:text-fg">
            <input
              type="checkbox"
              className="ue:accent-(--accent)"
              checked={g.unlessStepTargets !== false}
              onChange={(e) => setField('unlessStepTargets', e.target.checked ? undefined : false)}
            />
            {t('正在执行的那一步要点的就在这个界面里时不触发')}
          </label>
        </div>
      )}
    </div>
  )
}
