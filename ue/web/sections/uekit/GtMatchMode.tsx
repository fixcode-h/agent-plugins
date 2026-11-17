import { Check, ListTree, Pencil, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { op, ppost, useAction } from '../../api.ts'
import { h, t } from '../../host.ts'
import { Badge } from '../../ui.tsx'
import { applyKey, keyOf, showValue, sourceLabel, type KeyCand, type PreviewResult, type StepKey } from './gt-key.ts'
import { hintOf, isPositional } from './gt-steps.ts'
import { GtKeyFields } from './GtKeyFields.tsx'
import type { StepDef } from './GtStepDetail.tsx'

type Mode = 'key' | 'text' | 'index'

/**
 * 步骤详情「控件」里的「回放怎么认」（效果图 3）。
 * - 录制时点在列表、格子条目上的步骤有 hint.key（GameTest 1.4.0）：三档「按标识 / 先按文字找 / 只按第几个」，
 *   按标识时显示用的字段和值，录制时的其他候选点一下就换（游戏不用开着），也能打开「全部字段」现场挑组合。
 * - 旧步骤只有按位置写的选择器：两档「先按文字找 / 只按第几个」（GameTest 1.2.4 的 hint.byIndex）。
 * 改场景文件走 ext/gt/file replace（带原步骤核对，文件被改过就报错让刷新）。
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
  const [fields, setFields] = useState(false)
  const hint = hintOf(o.def)
  const key = keyOf(hint as Record<string, unknown> | undefined)
  const target = typeof o.def.target === 'string' ? o.def.target : ''
  if (!key && (!hint?.text || !isPositional(target))) return null
  const value: Mode = key?.cond ? 'key' : hint?.byIndex ? 'index' : 'text'

  /** 写回场景：target 和 hint 一起换 */
  const save = (nextTarget: string, nextHint: Record<string, unknown>, done: string) =>
    run('match', async () => {
      const step = { ...o.def, target: nextTarget, hint: nextHint }
      await ppost(o.project, 'ext/gt/file', {
        root: o.root,
        path: o.path,
        action: 'replace',
        index: o.index,
        expect: [o.def],
        steps: [step],
      })
      h().toast.success(done)
      o.onChanged()
    })

  /** 换认法：按标识时 cond 必填；按位置（文字 / 第几个）时 cond 空 */
  const switchTo = (mode: Mode, cond?: string) => {
    const rest: Record<string, unknown> = { ...hint }
    delete rest.byIndex
    if (!key) {
      if (mode === value) return
      return save(target, mode === 'index' ? { ...rest, byIndex: true } : rest, doneText(mode))
    }
    const c = mode === 'key' ? cond : undefined
    if (mode === 'key' && !c) return setFields(true)
    const next = applyKey(target, key, c)
    if (!next) return h().toast.error(t('这一步的 target 改过了，和录制时对不上：直接改 target 的方括号'))
    const nextKey: StepKey = { ...key, from: next.from, cond: c, by: mode === 'key' ? 'user' : mode }
    if (!c) delete nextKey.cond
    save(next.target, { ...rest, key: nextKey, ...(mode === 'index' ? { byIndex: true } : {}) }, doneText(mode))
  }

  const { ui } = h()
  const first = key?.cands?.find((c) => c.cond && c.unique && !c.changed)
  return (
    <div className="ue:flex ue:flex-col ue:gap-2">
      <ui.Segmented
        size="sm"
        label={t('回放怎么认')}
        value={value}
        onChange={(m: Mode) => m !== value && switchTo(m, m === 'key' ? first?.cond : undefined)}
        options={[
          ...(key ? [{ id: 'key' as const, label: t('按标识'), disabled: !!busy }] : []),
          { id: 'text' as const, label: t('先按文字找'), disabled: !!busy },
          { id: 'index' as const, label: t('只按第几个'), disabled: !!busy },
        ]}
      />
      {key && value === 'key' && (
        <KeyCard project={o.project} target={target} k={key} busy={!!busy} onChange={() => setFields(true)} />
      )}
      {(!key || value !== 'key') && (
        <p className="ue:text-footnote ue:text-subtle">
          {value === 'index'
            ? t('照选择器里的序号点，不管那个位置上现在写的是什么')
            : hint?.text
              ? t('那个位置上的文字不是「{s}」时，在同一个容器里找文字一样的点；找不到再按序号', { s: hint.text })
              : t('按序号点（没有录到文字，找不回来）')}
        </p>
      )}
      {key?.by === 'pending' && (
        <p className="ue:text-footnote ue:text-warning">
          {t('录制时拿不准用哪个字段认，先按下面最好的一个写了，看一眼再定')}
        </p>
      )}
      {key && <OtherCands k={key} busy={!!busy} onPick={(c) => switchTo('key', c)} />}
      {fields && key && (
        <FieldsDialog
          project={o.project}
          target={target}
          onClose={() => setFields(false)}
          onApply={(cond) => {
            setFields(false)
            switchTo('key', cond)
          }}
        />
      )}
    </div>
  )
}

function doneText(mode: Mode) {
  return mode === 'index'
    ? t('这一步回放只按第几个点')
    : mode === 'text'
      ? t('这一步回放先按文字在同容器里找')
      : t('这一步回放按标识认')
}

/** 按标识时：用的条件、来源、谁定的，「换一个」「在游戏里看命中」 */
function KeyCard({
  project,
  target,
  k,
  busy,
  onChange,
}: {
  project: string
  target: string
  k: StepKey
  busy: boolean
  onChange: () => void
}) {
  const { ui, toast } = h()
  const { run } = useAction()
  const cand = k.cands?.find((c) => c.cond === k.cond)
  const look = () =>
    run('preview', async () => {
      try {
        const r = await op<PreviewResult>(project, 'gt.keys.preview', { target, cond: k.cond })
        if (r.unique) toast.success(t('在 {n} 项里只认出一个，游戏里框出来了', { n: r.count }))
        else toast.error(t('在 {n} 项里认出 {m} 个', { n: r.count, m: r.hits }))
      } catch (e) {
        toast.error((e as Error).message)
      }
    })
  return (
    <div className="ue:flex ue:flex-col ue:gap-2 ue:rounded-lg ue:border ue:border-line ue:px-3 ue:py-2.5">
      <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5">
        <code className="ue:rounded-sm ue:bg-hover ue:px-1.5 ue:font-mono ue:text-footnote ue:text-fg">{k.cond}</code>
        <Badge>{cand?.combo ? t('组合') : sourceLabel(cand?.src, k.list)}</Badge>
        <Badge tone="accent">{byLabel(k.by)}</Badge>
      </div>
      <p className="ue:text-footnote ue:leading-relaxed ue:text-muted">
        {t(
          '在 {c} 的全部 {n} 项里找 {k} 的那一项，没滚到先滚过去；找不到就等，超时报错并列出现有的值，不退回按序号点。',
          {
            c: k.base.split('/').pop() ?? k.base,
            n: k.count ?? 0,
            k: k.cond ?? '',
          },
        )}
      </p>
      <div className="ue:flex ue:items-center ue:gap-2">
        <ui.Button size="sm" variant="secondary" disabled={busy} onClick={onChange}>
          <Pencil className="ue:h-3.5 ue:w-3.5" /> {t('换一个')}
        </ui.Button>
        <ui.Button size="sm" variant="ghost" disabled={busy} onClick={look}>
          <ScanSearch className="ue:h-3.5 ue:w-3.5" /> {t('在游戏里看命中')}
        </ui.Button>
      </div>
    </div>
  )
}

function byLabel(by: string) {
  if (by === 'auto') return t('录制时自动挑的')
  if (by === 'rule') return t('按规则')
  if (by === 'user') return t('你选的')
  if (by === 'pending') return t('待定')
  return by
}

/** 录制时的其他候选（hint.key.cands）：游戏不用开着也能换 */
function OtherCands({ k, busy, onPick }: { k: StepKey; busy: boolean; onPick: (cond: string) => void }) {
  const { cn } = h()
  const rest = (k.cands ?? []).filter((c): c is KeyCand & { cond: string } => !!c.cond && c.cond !== k.cond).slice(0, 6)
  if (!rest.length) return null
  return (
    <div className="ue:flex ue:flex-col">
      <span className="ue:pb-1 ue:text-caption ue:text-subtle">{t('录制时的其他候选（游戏不用开着也能换）')}</span>
      {rest.map((c) => (
        <button
          key={c.cond}
          type="button"
          disabled={busy}
          title={c.why}
          onClick={() => onPick(c.cond)}
          className={cn(
            'ue:grid ue:min-h-8 ue:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:text-left ue:hover:bg-hover',
          )}
        >
          <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg">
            {c.by} = {showValue(c.v)}
          </span>
          <span className="ue:truncate ue:text-footnote ue:text-subtle">
            {c.combo ? t('组合') : sourceLabel(c.src, k.list)}
          </span>
          {c.changed ? (
            <Badge tone="warn">{t('点完会变')}</Badge>
          ) : c.unique ? (
            <Badge tone="ok">
              <Check className="ue:mr-0.5 ue:h-3 ue:w-3" />
              {t('唯一')}
            </Badge>
          ) : (
            <Badge tone="warn">{t('命中 {n} 个', { n: c.hits ?? 0 })}</Badge>
          )}
        </button>
      ))}
    </div>
  )
}

/** 「换一个」：游戏开着、界面在时现场列全部字段，勾几个组合 */
function FieldsDialog({
  project,
  target,
  onClose,
  onApply,
}: {
  project: string
  target: string
  onClose: () => void
  onApply: (cond: string) => void
}) {
  const { ui } = h()
  const [picked, setPicked] = useState<string[]>([])
  return (
    <ui.Modal
      open
      size="lg"
      onOpenChange={(v: boolean) => !v && onClose()}
      title={t('换一个标识')}
      footer={
        <>
          <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-footnote ue:text-subtle">
            {picked.join(',')}
          </span>
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button disabled={!picked.length} onClick={() => onApply(picked.join(','))}>
            <ListTree className="ue:h-3.5 ue:w-3.5" /> {t('按它认')}
          </ui.Button>
        </>
      }
    >
      <p className="ue:text-footnote ue:text-subtle">
        {t('要游戏开着、这个界面在屏上：按这一步现在的选择器找到条目，列出它的全部字段。勾几个就是组合条件')}
      </p>
      <div className="ue:flex ue:h-96 ue:min-h-0 ue:flex-col">
        <GtKeyFields project={project} where={{ target }} picked={picked} onPick={setPicked} />
      </div>
    </ui.Modal>
  )
}
