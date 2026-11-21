import { Check, LayoutGrid, MousePointerClick, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { GtIdentItem, GtPropItem } from '../../../shared/gt-script/ref/types.ts'
import { identLeaves } from '../../../shared/gt-script/ref/ident-tree.ts'
import { op, useAction } from '../../api.ts'
import { h, t } from '../../host.ts'
import { PANE_FILL, PANE_FIXED, SplitHandle, usePane } from '../../split.tsx'
import { ErrorText, Note } from '../../ui.tsx'
import { type KeyAnswer, type KeyAsk } from './gt-key.ts'
import { defaultIdent } from './gt-ref/compare-table.ts'
import { asTarget, classShort, describeRef, targetText } from './gt-ref/describe.ts'
import { IdentList } from './gt-ref/IdentList.tsx'
import { itemsOf } from './gt-ref/pick/data.ts'
import { useProps, useRefHits, type PropsArgs } from './gt-ref/live.ts'
import { PropTree } from './gt-ref/PropTree.tsx'
import { ShotImage } from './GtRecordShot.tsx'

/**
 * 录制中暂停问「这个对象怎么认」（GameTest 2.0，协议 game-test-ref 第 8 节）：录制器点到的对象同类有好几个、
 * 又挑不出分数够的标识组合时暂停游戏推 gt.record { phase: 'ask' }，这里弹属性树：左边按下那一刻的截图和
 * 「被点的 → 对象」，右边属性树点准星挑标识（推荐的准星是主色），下面是标识组和此刻命中几个。
 * 选好后 gt.record.key { ident } 改写这一步并继续游戏。关掉弹窗 = 先跳过（这一步按第一个找、标待定，录完再定）。
 * edit：录制中从步骤列表点开、改前面某一步（游戏没停，关掉 = 不改）。勾「同类的都这样认」时写进 identRules，
 * 这次录制里同类已录的步骤一起改
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
  const tg = asTarget(ask.target)
  const ref = ask.ref ?? (tg && typeof tg.obj === 'object' ? tg.obj : undefined)
  const args: PropsArgs | undefined = ask.node
    ? { node: ask.node }
    : tg
      ? { target: { obj: tg.obj } }
      : ref
        ? { class: ref.class }
        : undefined
  const props = useProps(project, args)
  // 默认选推荐的：录制器给的引用里已有的标识，没有就用属性树的 suggest
  const [ident, setIdent] = useState<GtIdentItem[]>(() => identLeaves(ref?.ident))
  const seeded = useRef(!!ref?.ident?.length)
  useEffect(() => {
    if (seeded.current || !props.data?.suggest?.length) return
    seeded.current = true
    const items = props.data.groups.flatMap((g) => g.items)
    setIdent(
      props.data.suggest
        .map((p) => items.find((i) => i.prop === p))
        .filter((i): i is GtPropItem => !!i)
        .map(defaultIdent),
    )
  }, [props.data])
  // 默认记成规则、同类一起改：选一次就别再问（用户 2026-11-18）
  const [rule, setRule] = useState(true)
  const [all, setAll] = useState(true)
  const [err, setErr] = useState('')
  const left = useCountdown(edit ? undefined : timeoutSec, ask.pausedSec)
  const pane = usePane('gt-key-ask', '300px', 220)
  const paneRef = useRef<HTMLDivElement>(null)
  const cls = ref?.class ?? props.data?.class ?? ''
  const next = cls ? { ...(ref ?? { class: cls }), ident } : undefined
  const hits = useRefHits(project, true, next ? [{ id: 'me', ref: next }] : [])
  const me = hits.hits.me

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
      { ident, rule: rule || undefined },
      rule ? t('已按它认，以后同类也这样认') : edit ? t('已改好这一步') : t('已按它认，游戏继续'),
    )
  const close = () => (edit ? onDone() : answer({ mode: 'skip' }, t('先跳过，这一步录完再定')))
  const toggle = (it: GtPropItem) =>
    setIdent(
      ident.some((x) => x.prop === it.prop) ? ident.filter((x) => x.prop !== it.prop) : [...ident, defaultIdent(it)],
    )

  return (
    <ui.Modal
      open
      size="full"
      onOpenChange={(o: boolean) => !o && close()}
      title={edit ? t('改第 {n} 步怎么认', { n: ask.step + 1 }) : t('这个对象怎么认 · 第 {n} 步', { n: ask.step + 1 })}
      footer={
        <>
          <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:font-mono ue:text-footnote ue:text-subtle">
            {next ? (
              <>
                <span className="ue:font-sans">{t('存进脚本的只有：')}</span>
                {describeRef(next)}
              </>
            ) : edit ? (
              ''
            ) : (
              t('游戏里按 Alt+K 直接接受推荐')
            )}
          </span>
          <ui.Button variant="secondary" disabled={!!busy} onClick={close}>
            {edit ? t('取消') : t('先跳过，录完再定')}
          </ui.Button>
          <ui.Button disabled={!!busy || !cls} onClick={accept}>
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
      <div className="ue:flex ue:min-h-[58vh] ue:flex-1 ue:flex-col ue:overflow-auto ue:rounded-(--c-row-radius) ue:border ue:border-line ue:lg:flex-row ue:lg:overflow-hidden">
        <section
          ref={paneRef}
          style={pane.style('40%')}
          className={cn(PANE_FIXED, 'ue:relative ue:flex ue:flex-col ue:gap-3 ue:overflow-auto ue:p-3')}
        >
          <Chain project={project} ask={ask} cls={cls} />
          <SplitHandle pane={pane} paneRef={paneRef} reserve={() => 480} />
        </section>
        <section className={cn(PANE_FILL, 'ue:flex ue:min-h-0 ue:flex-col')}>
          <PropTree
            className="ue:min-h-60 ue:flex-1"
            data={props.data}
            loading={props.loading}
            error={props.error}
            mode="ident"
            selected={ident.map((i) => i.prop)}
            onPick={toggle}
            loadPart={props.loadPart}
          />
          <div className="ue:flex ue:max-h-[45%] ue:shrink-0 ue:flex-col ue:gap-2 ue:overflow-auto ue:border-t ue:border-line ue:p-3">
            <div className="ue:flex ue:items-center ue:gap-2">
              <span className="ue:text-footnote ue:font-medium ue:text-fg">{t('唯一标识组')}</span>
              {me && (
                <span className={cn('ue:text-caption', me.count === 1 ? 'ue:text-success' : 'ue:text-warning')}>
                  {me.count === 1 ? t('此刻只认出点的这一个') : t('此刻命中 {n} 个，再加一条', { n: me.count })}
                </span>
              )}
            </div>
            <IdentList value={ident} onChange={setIdent} items={itemsOf(props.data?.groups)} />
            <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:text-footnote ue:text-fg">
              <input
                type="checkbox"
                className="ue:accent-accent"
                checked={rule}
                disabled={!ident.length}
                onChange={(e) => setRule(e.target.checked)}
              />
              <span className="ue:min-w-0">
                {t('以后 {c} 都按这几项认，不再问', { c: classShort(cls) || t('这个类') })}
                <span className="ue:ml-1.5 ue:text-subtle">{t('（存进运行设置的「对象与标识」）')}</span>
              </span>
            </label>
            <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:text-footnote ue:text-fg">
              <input
                type="checkbox"
                className="ue:accent-accent"
                checked={all}
                onChange={(e) => setAll(e.target.checked)}
              />
              {t('这次录制里同类已录的步骤也改成这样')}
            </label>
            <ErrorText>{err}</ErrorText>
          </div>
        </section>
      </div>
    </ui.Modal>
  )
}

/** 左栏：按下那一刻的截图和「被点的 → 对象」 */
function Chain({ project, ask, cls }: { project: string; ask: KeyAsk; cls: string }) {
  const { api } = h()
  const shot = ask.shot ?? ask.screen
  const tg = asTarget(ask.target)
  const rows = [
    { icon: MousePointerClick, name: ask.text || tg?.part || targetText(ask.target), sub: t('被点的') },
    {
      icon: LayoutGrid,
      name: classShort(cls),
      sub: ask.index !== undefined ? t('列表条目 · 第 {n} 项', { n: ask.index + 1 }) : t('对象'),
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
      <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">
        {t('同类同时有好几个，选几个能把它和别的区分开的属性。位置、序号、会变的值不适合当标识。')}
      </p>
    </div>
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

/** 答完的提示：同类另外改了几步、哪几步改不了 */
function withApplied(done: string, r: KeyAnswer) {
  const parts = [done]
  if (r.applied) parts.push(t('同类另外改了 {n} 步', { n: r.applied }))
  if (r.skipped?.length)
    parts.push(
      t('第 {s} 步改不了：{why}', { s: r.skipped.map((x) => x.step + 1).join('、'), why: r.skipped[0]?.why ?? '' }),
    )
  if (r.ruleError) parts.push(t('规则没存上：{e}', { e: r.ruleError }))
  return parts.join('；')
}
