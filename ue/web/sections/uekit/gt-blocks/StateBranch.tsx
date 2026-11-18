import { ArrowDown, ArrowUp, Loader2, Plus, ScanEye, Trash2, Wand2 } from 'lucide-react'
import { useState } from 'react'
import type { CondNode, GtStep } from '../../../../shared/gt-script/index.ts'
import { op } from '../../../api.ts'
import { h, t } from '../../../host.ts'
import { openMenu } from '../../../menu.tsx'
import { CondEditor } from '../gt-cond/CondEditor.tsx'
import { TargetInput } from '../gt-cond/TargetInput.tsx'
import { useEditCtx } from '../gt-edit/ctx.ts'

/** 一条路：条件 + 步骤。最后的「其余情况」没有条件 */
interface Way {
  cond?: unknown
  then: GtStep[]
}

const ways = (s: GtStep): Way[] => [
  { cond: s.cond, then: (s.then as GtStep[]) ?? [] },
  ...(Array.isArray(s.elif) ? (s.elif as Way[]) : []),
]

/** 路的数组写回 if / elif（至少一条有条件的路） */
function withWays(s: GtStep, list: Way[]): GtStep {
  const [first, ...rest] = list
  const out: GtStep = { ...s, cond: first?.cond ?? { all: [] }, then: first?.then ?? [] }
  if (rest.length) out.elif = rest
  else delete out.elif
  return out
}

/**
 * 一键分路的几种分法（定稿 9.4A）：按控件给出常用的几条路，每条路的条件都是完整的条件组，之后可以随便改。
 * 反面的路（不显示、其余情况）由执行器按 elseSettleMs 稳住再走
 */
const PRESETS = (target: string): { label: string; ways: CondNode[]; rest: boolean }[] => [
  {
    label: t('能点 / 显示但不能点 / 其余'),
    ways: [
      { target, enabled: true },
      { all: [{ target, visible: true }, { target, enabled: false }] },
    ],
    rest: true,
  },
  { label: t('显示 / 不显示'), ways: [{ target, visible: true }], rest: true },
  { label: t('文字是 … / 其余'), ways: [{ target, text: '' }], rest: true },
  { label: t('勾上 / 没勾'), ways: [{ target, checked: true }], rest: true },
]

/**
 * 按状态分支（效果图 11）：同一个控件不同状态走不同的路。从上往下判断，走第一条成立的；都不成立走「其余情况」。
 * 每条路一张卡片：条件 + 这条路有几步（步骤在列表 / 流程图里往这条路里放）。连着游戏时「此刻走哪条」问一次 gt.resolve
 */
export function StateBranch({ step, onChange }: { step: GtStep; onChange: (s: GtStep) => void }) {
  const { ui, cn } = h()
  const ctx = useEditCtx()
  const [target, setTarget] = useState('')
  const [now, setNow] = useState<number>()
  const [checking, setChecking] = useState(false)
  const list = ways(step)
  const hasElse = Array.isArray(step.else)

  const set = (next: Way[]) => {
    setNow(undefined)
    onChange(withWays(step, next))
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    set(next)
  }

  const which = async () => {
    setChecking(true)
    try {
      const r = await op<{ conds?: { id: string; holds?: boolean }[] }>(ctx.project, 'gt.resolve', {
        conds: list.map((w, i) => ({ id: String(i), cond: w.cond ?? { all: [] } })),
      })
      const hit = list.findIndex((_, i) => r.conds?.find((c) => c.id === String(i))?.holds)
      setNow(hit < 0 ? (hasElse ? list.length : -1) : hit)
    } catch (e) {
      h().toast.error((e as Error).message)
    } finally {
      setChecking(false)
    }
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
        {t('从上往下判断，走第一条成立的路；都不成立走「其余情况」。反面的路要稳住才走，免得把「还没刷出来」当成「不显示」。')}
      </p>
      <div className="ue:flex ue:items-start ue:gap-1.5">
        <div className="ue:min-w-0 ue:flex-1">
          <TargetInput value={target} onChange={setTarget} placeholder={t('看哪个控件：WBP_Guide:Root/BtnFinish')} />
        </div>
        <ui.Button
          size="sm"
          variant="secondary"
          disabled={!target.trim()}
          onClick={(e: React.MouseEvent) =>
            openMenu(
              e,
              PRESETS(target.trim()).map((p) => ({
                label: p.label,
                onClick: () => {
                  // 换分法不丢步骤：新的第 k 条路接着用原来第 k 条路的步骤，多出来的有步骤的旧路留在后面
                  const fresh = p.ways.map((c, k) => ({ cond: c, then: list[k]?.then ?? [] }))
                  const left = list.slice(p.ways.length).filter((w) => w.then.length)
                  const next = withWays(step, [...fresh, ...left])
                  if (p.rest) next.else = (step.else as GtStep[]) ?? []
                  setNow(undefined)
                  onChange(next)
                },
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
        {ctx.live && (
          <ui.Button size="sm" variant="ghost" disabled={checking} onClick={() => void which()}>
            {checking ? <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" /> : <ScanEye className="ue:h-3.5 ue:w-3.5" />}
            {t('此刻走哪条')}
          </ui.Button>
        )}
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
      {now === -1 && <p className="ue:text-footnote ue:text-warning">{t('此刻哪条路都不成立，也没有「其余情况」：会直接往下走')}</p>}
    </div>
  )
}
