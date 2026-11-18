import {
  Check,
  CircleCheck,
  CircleX,
  LayoutGrid,
  ListTree,
  MousePointerClick,
  Pause,
  Play,
  ScanSearch,
  Star,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { op, useAction } from '../../api.ts'
import { h, t } from '../../host.ts'
import { Badge, ErrorText, Note } from '../../ui.tsx'
import {
  applyKey,
  fieldsOfCond,
  showValue,
  sourceLabel,
  type KeyAnswer,
  type KeyAsk,
  type KeyCand,
  type PreviewResult,
} from './gt-key.ts'
import { GtKeyFields } from './GtKeyFields.tsx'
import { ShotImage } from './GtRecordShot.tsx'

/**
 * 录制中暂停问「这一格怎么认」（GameTest 1.4.0，效果图 1、2）：录制器点到列表、格子里的条目又拿不准用哪个字段认时，
 * 暂停游戏推 gt.record { phase: 'ask' }，这里弹窗。左边是按下那一刻的截图和「被点的 → 条目 → 容器」，
 * 右边「推荐」列打好分的候选，「全部字段」可以勾几个组合；选好后 gt.record.key 改写这一步并继续游戏。
 * 关掉弹窗 = 先跳过（这一步保持待定，录完在步骤详情里再定），不让游戏一直停着没人管。
 * edit：录制中从步骤列表点开、改前面某一步（游戏没停，关掉 = 不改）。答过的认法 GameTest 1.5.0 起记在这次录制里，
 * 同一列表后面的条目直接沿用；勾「同一列表的都改」时这次录制里已录的同列表步骤一起改。
 */
export function GtKeyAsk({
  project,
  ask,
  timeoutSec,
  onDone,
  edit,
}: {
  project: string
  ask: KeyAsk
  /** 录制中改前面的某一步：不暂停、不倒计时，关掉不改 */
  edit?: boolean
  /** 设置里的自动继续秒数，0 = 一直等 */
  timeoutSec?: number
  onDone: () => void
}) {
  const { ui, cn, toast } = h()
  const { busy, run } = useAction()
  const key = ask.key
  const cands = useMemo(() => (key.cands ?? []).filter((c) => !!c.cond), [key.cands])
  const [tab, setTab] = useState<'rec' | 'all'>('rec')
  // 默认选推荐的：录制器已经挑了的条件，没有就选第一个唯一的
  const [picked, setPicked] = useState<string[]>(() => {
    const first = key.cond || cands.find((c) => c.unique && !c.changed)?.cond
    return first ? [first] : []
  })
  // 默认记成规则、同一列表一起改：选一次就别再问（用户 2026-11-18）
  const [rule, setRule] = useState(true)
  const [all, setAll] = useState(true)
  const [preview, setPreview] = useState<PreviewResult>()
  const [err, setErr] = useState('')
  const cond = picked.join(',')
  const rewritten = cond ? applyKey(ask.target, key, cond) : undefined
  const left = useCountdown(edit ? undefined : timeoutSec, ask.pausedSec)
  const entry = key.entry || ask.entryName || t('条目')

  useEffect(() => setPreview(undefined), [cond])

  const answer = (body: Record<string, unknown>, done: string) =>
    run('answer', async () => {
      setErr('')
      try {
        const r = await op<KeyAnswer>(project, 'gt.record.key', {
          step: ask.step,
          resume: !edit,
          ...(all && body.mode !== 'skip' ? { all: true } : {}),
          ...body,
        })
        toast.success(withApplied(done, r))
        onDone()
      } catch (e) {
        setErr((e as Error).message)
      }
    })
  const accept = () =>
    answer(
      { cond, rule: rule || undefined },
      rule ? t('已按它认，以后同类条目也这样认') : edit ? t('已改好这一步') : t('已按它认，游戏继续'),
    )
  const close = () => (edit ? onDone() : answer({ mode: 'skip' }, t('先跳过，这一步录完再定')))
  const look = () =>
    run('preview', async () => {
      setErr('')
      try {
        setPreview(await op<PreviewResult>(project, 'gt.keys.preview', { step: ask.step, cond }))
      } catch (e) {
        setErr((e as Error).message)
      }
    })

  return (
    <ui.Modal
      open
      size="xl"
      onOpenChange={(o: boolean) => !o && close()}
      title={edit ? t('改第 {n} 步怎么认', { n: ask.step + 1 }) : t('这一格怎么认 · 第 {n} 步', { n: ask.step + 1 })}
      footer={
        <>
          <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-footnote ue:text-subtle">
            {edit ? '' : t('游戏里按 Alt+K 直接接受推荐')}
          </span>
          <ui.Button variant="ghost" disabled={!!busy} onClick={() => answer({ mode: 'index' }, t('这一步按位置认'))}>
            {t('按位置（不推荐）')}
          </ui.Button>
          <ui.Button variant="secondary" disabled={!!busy} onClick={close}>
            {edit ? t('取消') : t('先跳过，录完再定')}
          </ui.Button>
          <ui.Button disabled={!!busy || !cond} onClick={accept}>
            {edit ? (
              <>
                <Check className="ue:h-3.5 ue:w-3.5" /> {t('改好')}
              </>
            ) : (
              <>
                <Play className="ue:h-3.5 ue:w-3.5" /> {t('按它认并继续')}
              </>
            )}
          </ui.Button>
        </>
      }
    >
      {!edit && (
        <Note
          action={
            left !== undefined && (
              <span className="ue:shrink-0 ue:tabular-nums ue:text-warning">
                {t('{t} 后自动继续', { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` })}
              </span>
            )
          }
        >
          <span className="ue:inline-flex ue:items-center ue:gap-1.5">
            <Pause className="ue:h-3.5 ue:w-3.5 ue:text-warning" />
            {ask.gamePaused === false ? t('等你选好再继续录制（游戏原本就停着）') : t('游戏已暂停，选好后继续录制')}
          </span>
        </Note>
      )}
      <div className="ue:grid ue:min-h-0 ue:gap-4 ue:md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <Chain project={project} ask={ask} entry={entry} />
        <div className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-col ue:gap-3">
          <div className="ue:flex ue:items-center ue:gap-3">
            <ui.Segmented
              size="sm"
              label={t('推荐 / 全部字段')}
              value={tab}
              onChange={setTab}
              options={[
                { id: 'rec' as const, label: `${t('推荐')} ${cands.length}` },
                { id: 'all' as const, label: t('全部字段') },
              ]}
            />
            <span className="ue:ml-auto ue:truncate ue:text-footnote ue:text-subtle">
              {tab === 'rec' ? t('按「唯一、不会变、像标识」排好了') : t('勾几个字段就是组合条件，都要满足')}
            </span>
          </div>
          {tab === 'rec' ? (
            <CandList cands={cands} list={key.list} picked={cond} onPick={(c) => setPicked(c ? [c] : [])} />
          ) : (
            <div className="ue:flex ue:h-80 ue:min-h-0 ue:flex-col">
              <GtKeyFields project={project} where={{ step: ask.step }} picked={picked} onPick={setPicked} />
            </div>
          )}
          <div className="ue:flex ue:flex-col ue:gap-2 ue:rounded-lg ue:bg-hover ue:px-3 ue:py-2.5">
            <div className="ue:flex ue:items-center ue:gap-2">
              <span className="ue:text-footnote ue:font-medium ue:text-fg">{t('回放这样找')}</span>
              <ui.Button size="sm" variant="secondary" className="ue:ml-auto" disabled={!!busy || !cond} onClick={look}>
                <ScanSearch className="ue:h-3.5 ue:w-3.5" /> {t('在游戏里看命中')}
              </ui.Button>
            </div>
            <code className="ue:block ue:truncate ue:rounded-md ue:border ue:border-line ue:bg-card ue:px-2 ue:py-1.5 ue:font-mono ue:text-footnote ue:text-fg">
              {rewritten?.target ?? ask.target}
            </code>
            {preview && (
              <p
                className={cn(
                  'ue:flex ue:items-center ue:gap-1.5 ue:text-footnote',
                  preview.unique && preview.includesMine ? 'ue:text-success' : 'ue:text-warning',
                )}
              >
                {preview.unique && preview.includesMine ? (
                  <CircleCheck className="ue:h-3.5 ue:w-3.5" />
                ) : (
                  <CircleX className="ue:h-3.5 ue:w-3.5" />
                )}
                {preview.unique && preview.includesMine
                  ? t('在 {n} 项里只认出点的这一项，没滚到也找得到，回放会先滚过去', { n: preview.count })
                  : preview.hits === 0
                    ? t('一个都认不出来：这个值点完就变了，换一个')
                    : t('在 {n} 项里认出 {m} 个，再勾一个字段组合', { n: preview.count, m: preview.hits })}
              </p>
            )}
          </div>
          <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:text-footnote ue:text-fg">
            <input
              type="checkbox"
              className="ue:accent-accent"
              checked={rule}
              disabled={!cond}
              onChange={(e) => setRule(e.target.checked)}
            />
            <span className="ue:min-w-0">
              {t('以后 {entry} 的条目都按 {by} 认，不再问', { entry, by: cond ? fieldsOfCond(cond).join(' + ') : '…' })}
              <span className="ue:ml-1.5 ue:text-subtle">{t('（存进运行设置）')}</span>
            </span>
          </label>
          <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:text-footnote ue:text-fg">
            <input
              type="checkbox"
              className="ue:accent-accent"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
            />
            <span className="ue:min-w-0">
              {t('这次录制里同一列表已录的步骤也改成这样')}
              <span className="ue:ml-1.5 ue:text-subtle">{t('（后面再点这个列表不再问）')}</span>
            </span>
          </label>
          <ErrorText>{err}</ErrorText>
        </div>
      </div>
    </ui.Modal>
  )
}

/** 左栏：按下那一刻的截图和「被点的 → 条目 → 容器」 */
function Chain({ project, ask, entry }: { project: string; ask: KeyAsk; entry: string }) {
  const { api } = h()
  const shot = ask.shot ?? ask.screen
  const rows = [
    { icon: MousePointerClick, name: ask.text || ask.target.split('>').pop() || '', sub: t('被点的') },
    { icon: ListTree, name: entry, sub: t('条目 · 第 {n} 项', { n: (ask.index ?? 0) + 1 }) },
    {
      icon: LayoutGrid,
      name: ask.key.base,
      sub: t('容器 · {c} · {n} 项', { c: ask.containerClass ?? '', n: ask.key.count ?? 0 }),
    },
  ]
  return (
    <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-3">
      {shot && (
        <ShotImage
          alt={t('按下那一刻')}
          src={api.url(`/p/${encodeURIComponent(project)}/ext/file?path=${encodeURIComponent(shot)}`)}
        />
      )}
      <div className="ue:flex ue:flex-col ue:gap-1">
        {rows.map((r, i) => (
          <div key={i} className="ue:flex ue:items-start ue:gap-2 ue:rounded-md ue:px-2 ue:py-1.5">
            <r.icon className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
            <div className="ue:min-w-0">
              <div className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg" title={r.name}>
                {r.name}
              </div>
              <div className="ue:truncate ue:text-caption ue:text-subtle">{r.sub}</div>
            </div>
          </div>
        ))}
      </div>
      {ask.key.list && (
        <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">
          {t('ListView 的条目控件滚动时会复用，所以按它显示的数据对象认。')}
        </p>
      )}
    </div>
  )
}

/** 推荐列表：一行一个候选，单选；最后一行是按位置（顺序变了就点错） */
function CandList({
  cands,
  list,
  picked,
  onPick,
}: {
  cands: KeyCand[]
  list?: boolean
  picked: string
  onPick: (cond: string) => void
}) {
  const { cn } = h()
  if (!cands.length)
    return (
      <p className="ue:rounded-lg ue:border ue:border-line ue:px-3 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
        {t('没找到写得进选择器的字段，到「全部字段」里看看，或按位置认')}
      </p>
    )
  return (
    <div className="ue:max-h-80 ue:overflow-auto ue:rounded-lg ue:border ue:border-line">
      {cands.map((c, i) => {
        const on = c.cond === picked
        return (
          <label
            key={c.cond}
            title={c.why}
            className={cn(
              'ue:grid ue:min-h-9 ue:cursor-pointer ue:grid-cols-[18px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:px-3 ue:hover:bg-hover',
              on && 'ue:bg-accent-soft',
            )}
          >
            <input
              type="radio"
              name="gt-key"
              className="ue:accent-accent"
              checked={on}
              onChange={() => onPick(c.cond ?? '')}
            />
            <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1 ue:font-mono ue:text-footnote ue:text-fg">
              {i === 0 && c.unique && !c.changed && <Star className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-warning" />}
              <span className="ue:truncate">{c.by}</span>
            </span>
            <span className="ue:truncate ue:font-mono ue:text-footnote ue:text-muted">{showValue(c.v)}</span>
            <span className="ue:truncate ue:text-footnote ue:text-subtle">
              {c.combo ? t('组合') : sourceLabel(c.src, list)}
            </span>
            <CandBadge c={c} />
          </label>
        )
      })}
    </div>
  )
}

function CandBadge({ c }: { c: KeyCand }) {
  if (c.changed) return <Badge tone="warn">{t('点完会变')}</Badge>
  if (!c.unique) return <Badge tone="warn">{t('命中 {n} 个', { n: c.hits ?? 0 })}</Badge>
  if (c.why) return <Badge tone="danger">{c.why}</Badge>
  return (
    <Badge tone="ok">
      <Check className="ue:mr-0.5 ue:h-3 ue:w-3" />
      {t('唯一')}
    </Badge>
  )
}

/** 自动继续倒计时（秒）：设置里是 0 时不显示 */
function useCountdown(timeoutSec: number | undefined, pausedSec: number | undefined) {
  const [now, setNow] = useState(() => Date.now())
  const [start] = useState(() => Date.now() - (pausedSec ?? 0) * 1000)
  useEffect(() => {
    if (!timeoutSec) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timeoutSec])
  if (!timeoutSec) return undefined
  return Math.max(0, Math.round(timeoutSec - (now - start) / 1000))
}

/** 答完的提示：同一列表另外改了几步、哪几步改不了 */
function withApplied(done: string, r: KeyAnswer) {
  const parts = [done]
  if (r.applied) parts.push(t('同一列表另外改了 {n} 步', { n: r.applied }))
  if (r.skipped?.length)
    parts.push(
      t('第 {s} 步改不了：{why}', { s: r.skipped.map((x) => x.step + 1).join('、'), why: r.skipped[0]?.why ?? '' }),
    )
  if (r.ruleError) parts.push(t('规则没存上：{e}', { e: r.ruleError }))
  return parts.join('；')
}
