import { FileCheck2, Loader2, Sparkles, Undo2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { op, ppost } from '../../api.ts'
import { useToChat } from '../../chat.tsx'
import { h, t } from '../../host.ts'
import { Confirm, ErrorText } from '../../ui.tsx'
import { rowSummary, type StepDef } from './GtStepDetail.tsx'
import { checkSteps, diffCounts, diffSteps, type DiffRow } from './gt-tidy-diff.ts'
import { tidyPrompt } from './gt-tidy-prompt.ts'

/**
 * GameTest 页「AI 整理」（2026-11-16 用户提）：录制交给 Agent 矫正、简化成真正的测试步骤，每步写中文说明（note）。
 * 流程：写一句这份测试要验证什么 → 面板给出整理稿的路径、提示词放进对话 → Agent 写整理稿（产物目录里，不碰场景文件）
 * → 这里看步骤差异 → 保存时面板备份原录制（.json.bak）再写回。整理稿写没写好不轮询：
 * 打开场景、窗口回到前台时看一次，用户也可以点「看整理结果」。
 */
interface TidyStatus {
  draft: boolean
  /** 原录制备份（相对场景根），没有是空串 */
  backup: string
}

interface TidyDraft {
  hash: string
  original: StepDef[]
  summary: string
  changes: { what: string; from?: number[]; to?: number[] }[]
  scenario: { steps: StepDef[] }
  backup: string
}

export function useGtTidy(o: {
  project: string
  root: string
  path: string
  /** 编辑器连着：能拿 gt.actions 核对整理稿的动作和字段 */
  live: boolean
  onSaved: () => void
}) {
  const { ui, toast } = h()
  const chat = useToChat()
  const [status, setStatus] = useState<TidyStatus>()
  const [waiting, setWaiting] = useState(false)
  const [asking, setAsking] = useState(false)
  const [view, setView] = useState<TidyDraft>()
  const [restoring, setRestoring] = useState(false)
  const call = <T,>(action: string, extra: Record<string, unknown> = {}) =>
    ppost<T>(o.project, 'ext/gt/tidy', { root: o.root, path: o.path, action, ...extra })

  const refresh = () =>
    void call<TidyStatus>('status')
      .then(setStatus)
      .catch(() => undefined)
  useEffect(() => {
    if (!o.root) return
    refresh()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // 换场景时重看；refresh 每次渲染都是新函数
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [o.project, o.root, o.path])

  const send = async (need: string) => {
    setAsking(false)
    try {
      const r = await call<{ draftPath: string; scenarioPath: string }>('prepare')
      setWaiting(true)
      setStatus((s) => ({ backup: s?.backup ?? '', draft: false }))
      chat.send(tidyPrompt({ scenarioPath: r.scenarioPath, draftPath: r.draftPath, source: o.path, need }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const open = async () => {
    try {
      setView(await call<TidyDraft>('load'))
      setWaiting(false)
    } catch (e) {
      toast.error((e as Error).message)
      refresh()
    }
  }
  const discard = async () => {
    setView(undefined)
    setWaiting(false)
    await call('discard').catch(() => undefined)
    refresh()
  }
  const save = async () => {
    if (!view) return
    try {
      const r = await call<{ steps: number; backup: string; keptOldBackup: boolean }>('apply', { hash: view.hash })
      setView(undefined)
      toast.success(
        r.keptOldBackup
          ? t('已保存，{n} 步；最早的原录制还在 {b}', { n: r.steps, b: r.backup })
          : t('已保存，{n} 步；原录制备份在 {b}', { n: r.steps, b: r.backup }),
      )
      refresh()
      o.onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const restore = async () => {
    setRestoring(false)
    try {
      await call('restore')
      toast.success(t('已恢复成原录制'))
      refresh()
      o.onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const bar =
    status?.draft || waiting ? (
      <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-accent-soft/40 ue:px-4 ue:py-2 ue:text-footnote">
        {status?.draft ? (
          <FileCheck2 className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-accent-text" />
        ) : (
          <Loader2 className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:animate-spin ue:text-subtle" />
        )}
        <span className="ue:min-w-0 ue:flex-1 ue:text-fg">
          {status?.draft
            ? t('AI 整理稿写好了：看过步骤差异再保存，原录制会备份')
            : t('已交给 Agent 整理，写好后点「看整理结果」')}
        </span>
        <ui.Button size="sm" onClick={() => void open()}>
          {t('看整理结果')}
        </ui.Button>
        <ui.Button size="sm" variant="secondary" onClick={() => void discard()}>
          {status?.draft ? t('放弃') : t('不等了')}
        </ui.Button>
      </div>
    ) : null

  const dialogs = (
    <>
      {asking && <TidyAsk onClose={() => setAsking(false)} onSend={(need) => void send(need)} />}
      {view && (
        <TidyPreview
          draft={view}
          project={o.project}
          live={o.live}
          onClose={() => setView(undefined)}
          onDiscard={() => void discard()}
          onSave={() => void save()}
        />
      )}
      {chat.dialog}
      <Confirm
        open={restoring}
        danger
        title={t('恢复成原录制')}
        okText={t('恢复')}
        onOk={() => void restore()}
        onCancel={() => setRestoring(false)}
      >
        {t('用备份 {b} 盖回场景文件，整理过的步骤和说明都会丢掉（用 git、P4 管着的可以从版本库找回）。', {
          b: status?.backup ?? '',
        })}
      </Confirm>
    </>
  )

  return {
    /** 对话钩子不在（旧面板）时没法交给 Agent */
    available: chat.available,
    hasBackup: !!status?.backup,
    ask: () => setAsking(true),
    restore: () => setRestoring(true),
    bar,
    dialogs,
  }
}

/** 交给 Agent 前问一句：这份测试要验证什么（可以不填，Agent 按录制自己判断） */
function TidyAsk({ onClose, onSend }: { onClose: () => void; onSend: (need: string) => void }) {
  const { ui } = h()
  const [need, setNeed] = useState('')
  return (
    <ui.Modal
      open
      onOpenChange={(v: boolean) => !v && onClose()}
      title={t('AI 整理录制')}
      footer={
        <>
          <span className="ue:flex-1" />
          <ui.Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </ui.Button>
          <ui.Button onClick={() => onSend(need)}>
            <Sparkles className="ue:h-3.5 ue:w-3.5" />
            {t('交给 Agent')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3">
        <p className="ue:text-footnote ue:leading-relaxed ue:text-subtle">
          {t(
            'Agent 会去掉重复点击、误按的修饰键和多余的等待，坐标点击能认出控件的改成控件步骤，检查点改成断言，并给每一步写中文说明。它只写整理稿，你看过步骤差异点保存才改场景文件，原录制会备份。',
          )}
        </p>
        <ui.Field label={t('这份测试要验证什么')} hint={t('可以不填：Agent 按录制自己判断哪些步骤有用')}>
          <ui.Textarea
            rows={3}
            value={need}
            placeholder={t('例如：用 GM 加一件道具，确认背包里出现它')}
            onChange={(e: { target: { value: string } }) => setNeed(e.target.value)}
          />
        </ui.Field>
      </div>
    </ui.Modal>
  )
}

/** 一行步骤：动作名 + 说明（note）+ 目标或参数 */
function StepLine({ def }: { def: StepDef }) {
  const sum = rowSummary({ i: 0, def })
  const note = typeof def.note === 'string' ? def.note : ''
  return (
    <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
      <span className="ue:w-24 ue:shrink-0 ue:truncate ue:font-mono ue:text-fg">{def.action}</span>
      {note && <span className="ue:shrink-0 ue:text-fg">{note}</span>}
      <span className="ue:min-w-0 ue:truncate ue:text-subtle">
        {[sum.human, sum.target ?? (note ? '' : sum.text)].filter(Boolean).join(' · ')}
      </span>
    </span>
  )
}

function TidyPreview({
  draft,
  project,
  live,
  onClose,
  onDiscard,
  onSave,
}: {
  draft: TidyDraft
  project: string
  live: boolean
  onClose: () => void
  onDiscard: () => void
  onSave: () => void
}) {
  const { ui, cn } = h()
  const steps = draft.scenario.steps
  const rows = useMemo(() => diffSteps(draft.original, steps), [draft, steps])
  const n = diffCounts(rows)
  const noNote = steps.filter((s) => typeof s.note !== 'string' || !s.note.trim()).length
  // 动作名、字段对不对：要编辑器开着才拿得到 gt.actions；拿不到就不核对，保存后回放时 GameTest 自己会报
  const [issues, setIssues] = useState<string[]>()
  useEffect(() => {
    if (!live) return
    op<{ actions?: { name: string; params?: string[] }[]; common?: Record<string, unknown> }>(project, 'gt.actions')
      .then((r) =>
        setIssues(checkSteps(steps, { actions: r.actions ?? [], common: Object.keys(r.common ?? {}).concat('hint') })),
      )
      .catch(() => undefined)
  }, [live, project, steps])
  const tone = (r: DiffRow) =>
    r.kind === 'del'
      ? 'ue:bg-danger/8 ue:text-danger ue:line-through ue:decoration-danger/50'
      : r.kind === 'add'
        ? 'ue:bg-success/9'
        : ''
  return (
    <ui.Modal
      open
      size="xl"
      onOpenChange={(v: boolean) => !v && onClose()}
      title={t('AI 整理结果')}
      footer={
        <>
          <ui.Button variant="secondary" onClick={onDiscard}>
            <X className="ue:h-3.5 ue:w-3.5" />
            {t('放弃整理稿')}
          </ui.Button>
          <span className="ue:flex-1" />
          <ui.Button variant="secondary" onClick={onClose}>
            {t('稍后再看')}
          </ui.Button>
          <ui.Button disabled={!!issues?.length} onClick={onSave}>
            {t('保存到场景')}
          </ui.Button>
        </>
      }
    >
      <div className="ue:flex ue:flex-col ue:gap-3 ue:text-footnote">
        {draft.summary && <p className="ue:leading-relaxed ue:text-fg">{draft.summary}</p>}
        <p className="ue:text-subtle">
          {t('原录制 {a} 步 → 整理后 {b} 步：留着 {s}，删掉 {d}，新加或改过 {n}', {
            a: draft.original.length,
            b: steps.length,
            s: n.same,
            d: n.del,
            n: n.add,
          })}
          {noNote > 0 && ` · ${t('{n} 步没写说明', { n: noNote })}`}
          {draft.backup
            ? ` · ${t('已有原录制备份 {b}，保存不会覆盖它', { b: draft.backup })}`
            : ` · ${t('保存时原录制备份成 .json.bak')}`}
        </p>
        {issues && issues.length > 0 && (
          <ErrorText>
            {t('这几步 GameTest 不认识，保存了也跑不起来，让 Agent 按 ue_gametest action=actions 改：{s}', {
              s: issues.join('；'),
            })}
          </ErrorText>
        )}
        {draft.changes.length > 0 && (
          <ul className="ue:flex ue:flex-col ue:gap-1 ue:rounded-lg ue:bg-field/60 ue:px-3 ue:py-2">
            {draft.changes.map((c, i) => (
              <li key={i} className="ue:flex ue:gap-2">
                <span className="ue:shrink-0 ue:font-mono ue:text-caption ue:text-subtle ue:tabular-nums">
                  {c.from?.length ? `#${c.from.join(',')}` : '+'}
                  {c.to?.length ? ` → #${c.to.join(',')}` : ''}
                </span>
                <span className="ue:min-w-0 ue:text-fg">{c.what}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="ue:flex ue:flex-col ue:overflow-hidden ue:rounded-lg ue:border ue:border-line">
          {rows.map((r, i) => {
            const def = r.kind === 'add' ? steps[r.b] : draft.original[r.a]
            const shown = r.kind === 'same' ? steps[r.b] : def
            return (
              <div
                key={i}
                className={cn(
                  'ue:grid ue:grid-cols-[36px_36px_14px_minmax(0,1fr)] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:px-2 ue:py-1.5 ue:last:border-b-0',
                  tone(r),
                )}
              >
                <span className="ue:text-right ue:text-caption ue:text-subtle ue:tabular-nums">
                  {r.kind !== 'add' ? r.a + 1 : ''}
                </span>
                <span className="ue:text-right ue:text-caption ue:text-subtle ue:tabular-nums">
                  {r.kind !== 'del' ? r.b + 1 : ''}
                </span>
                <span
                  className={cn(
                    'ue:text-center ue:font-mono',
                    r.kind === 'del' ? 'ue:text-danger' : r.kind === 'add' ? 'ue:text-success' : 'ue:text-subtle',
                  )}
                >
                  {r.kind === 'del' ? '−' : r.kind === 'add' ? '+' : ''}
                </span>
                <StepLine def={shown} />
              </div>
            )
          })}
        </div>
      </div>
    </ui.Modal>
  )
}

/** 场景页头的两个按钮：AI 整理、恢复成原录制（有备份时） */
export function TidyButtons({ tidy, disabled }: { tidy: ReturnType<typeof useGtTidy>; disabled?: boolean }) {
  const { ui } = h()
  if (!tidy.available) return null
  return (
    <>
      <ui.IconButton
        icon={Sparkles}
        size="sm"
        label={t('AI 整理：让 Agent 把录制改成真正的测试步骤，每步写中文说明；看过差异再保存')}
        disabled={disabled}
        onClick={tidy.ask}
      />
      {tidy.hasBackup && (
        <ui.IconButton
          icon={Undo2}
          size="sm"
          label={t('恢复成原录制（AI 整理前的备份）')}
          disabled={disabled}
          onClick={tidy.restore}
        />
      )}
    </>
  )
}
