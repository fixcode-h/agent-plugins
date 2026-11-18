import { Check, CircleCheck, CircleX, Code, Plus, ScanSearch, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { op, useAction } from '../../api.ts'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { Badge, Note } from '../../ui.tsx'
import { hintOf } from './gt-steps.ts'
import { patchStep } from './gt-step-patch.ts'
import {
  candLevel,
  condOf,
  condSay,
  type GtSkipIf as SkipIf,
  type GtStateCand,
  parseSkipText,
  sameAsCand,
  SKIP_MIN_VERSION,
  skipFromCand,
  skipOf,
  skipSupported,
  stateOf,
} from './gt-skip.ts'
import type { StepDef } from './GtStepDetail.tsx'

/** gt.resolve checks 的一项（GameTest 1.7.0） */
interface CheckItem {
  index: number
  holds?: boolean
  say?: string
  actual?: string
  error?: string
}

/** 这一步能不能写跳过条件：要有目标控件（条件省略 target 时看它），或者已经写了 */
export const canSkip = (def?: StepDef) => !!def && (typeof def.target === 'string' || !!skipOf(def))

/**
 * 步骤详情的「已达成就跳过」（GameTest 1.7.0，设计稿 5.2）：现在的条件说成一句人话、看哪个控件、连带几步、做完核对；
 * 「现在核对」用此刻的游戏判断一次；下面列录制时点完变了的候选（hint.state），点一个就换，游戏不用开着。
 * edit 不给时只读（跑着、没有场景文件）
 */
export function GtSkipIf({
  def,
  edit,
}: {
  def: StepDef
  edit?: { project: string; root: string; path: string; index: number; onChanged: () => void; locked?: boolean }
}) {
  const { state } = useUe()
  const { ui } = h()
  const { busy, run } = useAction()
  const skip = skipOf(def)
  const cands = stateOf(hintOf(def) as Record<string, unknown> | undefined)?.cands ?? []
  const version = state?.extensions?.find((x) => x.name === 'GameTest')?.version
  const supported = skipSupported(version)
  const [text, setText] = useState<string>()
  const [check, setCheck] = useState<CheckItem>()
  const [also, setAlso] = useState(String(skip?.also ?? 0))
  useEffect(() => setAlso(String(skip?.also ?? 0)), [skip?.also])
  const skipKey = JSON.stringify(skip ?? null)
  useEffect(() => setCheck(undefined), [skipKey, edit?.index])
  const off = !edit || edit.locked || !!busy || !supported

  const save = (next: SkipIf | undefined, done: string) =>
    edit &&
    run('skip', async () => {
      await patchStep(edit, edit.index, def, { skipIf: next })
      h().toast.success(done)
      setText(undefined)
      edit.onChanged()
    })

  const checkNow = () =>
    edit &&
    run('check', async () => {
      const r = await op<{ checks: CheckItem[] }>(edit.project, 'gt.resolve', { checks: [def] })
      setCheck(r.checks?.[0])
    })

  const saveAlso = () => {
    const n = Math.round(Number(also))
    if (!skip || !Number.isFinite(n) || n === (skip.also ?? 0)) return setAlso(String(skip?.also ?? 0))
    if (n < 0 || n > 20) {
      h().toast.error(t('连带跳过要填 0 到 20 步'))
      return setAlso(String(skip.also ?? 0))
    }
    void save({ ...skip, also: n || undefined }, n ? t('跳过时连后面 {n} 步一起跳过', { n }) : t('跳过时只跳过这一步'))
  }

  const saveText = () => {
    const r = parseSkipText(text ?? '')
    if (r.error) return void h().toast.error(r.error)
    void save({ ...r.skip, by: 'user' }, t('已改跳过条件'))
  }

  const verify = skip?.verify === false ? 'off' : 'inherit'

  return (
    <div className="ue:flex ue:flex-col ue:gap-2.5">
      {!supported && (
        <Note>
          {t('要 GameTest {v} 才认跳过条件，旧版会整个场景解析失败：先在「UE 插件」里升级', { v: SKIP_MIN_VERSION })}
        </Note>
      )}
      {skip ? (
        <div className="ue:flex ue:flex-col ue:gap-2 ue:rounded-lg ue:border ue:border-line ue:px-3 ue:py-2.5">
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5">
            <code className="ue:rounded-sm ue:bg-hover ue:px-1.5 ue:font-mono ue:text-footnote ue:text-fg">
              {JSON.stringify(condOf(skip))}
            </code>
            {skip.by === 'auto' && <Badge tone="accent">{t('录制时自动加的')}</Badge>}
          </div>
          <p className="ue:text-footnote ue:leading-relaxed ue:text-muted">
            {t('回放到这一步时，{w}{c}就不做了，记成「已达成」，不算失败。', {
              w: skip.target ? t('{s} ', { s: skip.target.split(/[/>]/).pop() ?? skip.target }) : t('这个控件'),
              c: condSay(condOf(skip)),
            })}
          </p>
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:text-footnote">
            <span className="ue:text-subtle">{t('连带跳过后面')}</span>
            <ui.Input
              size="sm"
              className="ue:w-14"
              inputMode="numeric"
              disabled={off}
              value={also}
              onChange={(e: { target: { value: string } }) => setAlso(e.target.value)}
              onBlur={saveAlso}
              onKeyDown={(e: { key: string }) => e.key === 'Enter' && saveAlso()}
            />
            <span className="ue:text-subtle">{t('步')}</span>
            <span className="ue:ml-3 ue:text-subtle">{t('做完核对')}</span>
            <ui.Segmented
              size="sm"
              value={verify}
              onChange={(v: string) =>
                v !== verify &&
                void save(
                  { ...skip, verify: v === 'off' ? false : undefined },
                  v === 'off' ? t('这一步做完不再核对') : t('做完核对跟随运行设置'),
                )
              }
              options={[
                { id: 'inherit', label: t('跟随'), disabled: off },
                { id: 'off', label: t('不核对'), disabled: off },
              ]}
            />
          </div>
          {check && <CheckLine c={check} />}
          <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
            <ui.Button size="sm" variant="secondary" disabled={!edit || !!busy || !supported} onClick={checkNow}>
              <ScanSearch className="ue:h-3.5 ue:w-3.5" /> {t('现在核对')}
            </ui.Button>
            <ui.Button
              size="sm"
              variant="ghost"
              disabled={off}
              onClick={() => setText(text === undefined ? JSON.stringify(skip, null, 2) : undefined)}
            >
              <Code className="ue:h-3.5 ue:w-3.5" /> {t('手写条件')}
            </ui.Button>
            <ui.Button
              size="sm"
              variant="ghost"
              disabled={off}
              onClick={() => void save(undefined, t('去掉了跳过条件：回放总是照做'))}
            >
              <Trash2 className="ue:h-3.5 ue:w-3.5" /> {t('去掉')}
            </ui.Button>
          </div>
        </div>
      ) : (
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
          <p className="ue:min-w-0 ue:flex-1 ue:text-footnote ue:text-subtle">
            {t('回放总是照做。界面已经是这一步想要的样子时（勾已勾上、按钮已是「已领取」）可以跳过它')}
          </p>
          <ui.Button
            size="sm"
            variant="secondary"
            disabled={off}
            onClick={() => setText(JSON.stringify(cands[0] ? skipFromCand(cands[0]) : { checked: true }, null, 2))}
          >
            <Plus className="ue:h-3.5 ue:w-3.5" /> {t('加跳过条件')}
          </ui.Button>
        </div>
      )}
      {text !== undefined && (
        <div className="ue:flex ue:flex-col ue:gap-1.5">
          <ui.Textarea
            rows={5}
            className="ue:font-mono"
            value={text}
            onChange={(e: { target: { value: string } }) => setText(e.target.value)}
          />
          <p className="ue:text-caption ue:text-subtle">
            {t(
              '条件和 assert 一样：checked、visible、enabled、textLike（忽略数字和标点）、text、field + equals、image、any；target 省略 = 这一步的控件，also 连带几步',
            )}
          </p>
          <div className="ue:flex ue:justify-end ue:gap-2">
            <ui.Button size="sm" variant="ghost" onClick={() => setText(undefined)}>
              {t('取消')}
            </ui.Button>
            <ui.Button size="sm" disabled={off} onClick={saveText}>
              <Check className="ue:h-3.5 ue:w-3.5" /> {t('保存')}
            </ui.Button>
          </div>
        </div>
      )}
      {cands.length > 0 && (
        <div className="ue:flex ue:flex-col">
          <span className="ue:pb-1 ue:text-caption ue:text-subtle">
            {t('录制时点完变了的（点一个就用它，游戏不用开着）')}
          </span>
          {cands.map((c, k) => (
            <CandRow
              key={k}
              c={c}
              current={sameAsCand(skip, c)}
              disabled={off}
              onPick={() => void save(skipFromCand(c, skip), t('跳过条件换成：{s}', { s: condSay(c.cond) }))}
            />
          ))}
          <span className="ue:pt-1 ue:text-caption ue:text-subtle">{t('只变了数字、倒计时的已经去掉')}</span>
        </div>
      )}
    </div>
  )
}

function CandRow({
  c,
  current,
  disabled,
  onPick,
}: {
  c: GtStateCand
  current: boolean
  disabled: boolean
  onPick: () => void
}) {
  const { cn } = h()
  return (
    <button
      type="button"
      disabled={disabled || current}
      onClick={onPick}
      title={c.target ?? t('这一步点的控件')}
      className={cn(
        'ue:grid ue:min-h-8 ue:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:text-left ue:enabled:hover:bg-hover',
        current && 'ue:bg-sel/60',
      )}
    >
      <span className="ue:truncate ue:text-footnote ue:text-fg">{condSay(c.cond)}</span>
      <span className="ue:truncate ue:font-mono ue:text-caption ue:text-subtle">
        {c.before !== undefined && c.after !== undefined ? `${c.before} → ${c.after}` : ''}
      </span>
      {current ? (
        <Badge tone="ok">
          <Check className="ue:mr-0.5 ue:h-3 ue:w-3" />
          {t('在用')}
        </Badge>
      ) : (
        <Badge tone={c.score >= 7 ? 'ok' : 'muted'}>{candLevel(c.score)}</Badge>
      )}
    </button>
  )
}

function CheckLine({ c }: { c: CheckItem }) {
  if (c.error) return <p className="ue:text-footnote ue:text-danger">{c.error}</p>
  return (
    <p className="ue:flex ue:items-start ue:gap-1.5 ue:text-footnote">
      {c.holds ? (
        <CircleCheck className="ue:mt-0.5 ue:h-3 ue:w-3 ue:shrink-0 ue:text-success" />
      ) : (
        <CircleX className="ue:mt-0.5 ue:h-3 ue:w-3 ue:shrink-0 ue:text-subtle" />
      )}
      <span className="ue:min-w-0 ue:text-fg">
        {c.holds ? t('此刻已达成，回放会跳过') : t('此刻没达成，回放会照做')}
        {c.actual && <span className="ue:ml-1 ue:text-subtle">{t('（{s}）', { s: c.actual })}</span>}
      </span>
    </p>
  )
}
