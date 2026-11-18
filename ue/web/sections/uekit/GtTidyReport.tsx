import { CircleCheck, Info, Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Task } from '../../../../sdk/web.ts'
import { ppost } from '../../api.ts'
import { h, t } from '../../host.ts'
import { ErrorText } from '../../ui.tsx'
import { flowOpLabel } from '../../../server/uekit/gt-tidy-flow.ts'
import {
  applyTidyDoc,
  parseTidyPlan,
  tidyBlockOf,
  type TidyOp,
  type TidyPlan,
  type TidyResult,
} from '../../../server/uekit/gt-tidy-plan.ts'
import { diffSteps } from './gt-tidy-diff.ts'
import { ShotImage } from './GtRecordShot.tsx'
import { rowSummary, type StepDef } from './GtStepDetail.tsx'
import type { TidySource } from './gt-tidy-prompt.ts'

/**
 * AI 分析窗口右侧的「GameTest 整理」（面板 WebPlugin.reports，回复里的 gametest-tidy 代码块）：
 * 列出 summary、代码分析看出的问题（review，只提示）、每条改动（旁边是那一步的录制截图）和每步说明，
 * 逐条勾选，下面实时显示应用后的步骤差异；点应用才写回场景文件（服务端再核对一遍、备份原录制）。
 */
const APPLIED_KEY = 'ue:gt-tidy-applied'
const readApplied = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(APPLIED_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
const markApplied = (id: string) => {
  try {
    localStorage.setItem(APPLIED_KEY, JSON.stringify([...readApplied().filter((x) => x !== id), id].slice(-50)))
  } catch {
    // 存不了（隐私模式、存满）就只在这次打开里记着
  }
}

const opLabel = (c: TidyOp) =>
  c.op === 'delete'
    ? t('删除第 {s} 步', { s: c.steps.join('、') })
    : c.op === 'replace'
      ? t('第 {s} 步换成 {n} 步', { s: c.steps.join('、'), n: c.with.length })
      : c.op === 'insert'
        ? c.after
          ? t('第 {s} 步后面插入 {n} 步', { s: c.after, n: c.with.length })
          : t('最前面插入 {n} 步', { n: c.with.length })
        : c.op === 'edit'
          ? t('改第 {s} 步：{k}', { s: c.step, k: Object.keys(c.set).join('、') })
          : flowOpLabel(c, t)

const firstStep = (c: TidyOp) =>
  c.op === 'param'
    ? c.uses[0].step
    : c.op === 'delete' || c.op === 'replace' || c.op === 'wrap' || c.op === 'guard'
      ? c.steps[0]
      : c.op === 'edit'
        ? c.step
        : c.after

export function GtTidyReport({ task, messageId, text }: { task: Task; messageId: string; text: string }) {
  const { ui, cn, api, toast } = h()
  const project = task.projectId
  const raw = useMemo(() => {
    const block = tidyBlockOf(text)
    if (!block) return { error: t('这条回复里没有 gametest-tidy 代码块') }
    try {
      return { json: JSON.parse(block) as Record<string, unknown> }
    } catch (e) {
      return { error: t('gametest-tidy 代码块不是合法的 JSON：{e}', { e: (e as Error).message }) }
    }
  }, [text])
  const sc = (raw.json?.scenario ?? {}) as { root?: string; path?: string; hash?: string }
  const [src, setSrc] = useState<TidySource & { backup: string }>()
  const [err, setErr] = useState('')
  const [applied, setApplied] = useState(() => readApplied().includes(messageId))
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!sc.root || !sc.path) return
    ppost<TidySource & { backup: string }>(project, 'ext/gt/tidy', {
      root: sc.root,
      path: sc.path,
      action: 'source',
    }).then(setSrc, (e: Error) => setErr(e.message))
  }, [project, sc.root, sc.path])

  const plan = useMemo((): { plan?: TidyPlan; error?: string } => {
    if (!raw.json || !src) return {}
    try {
      return { plan: parseTidyPlan(raw.json, src.steps.length) }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [raw.json, src])
  const p = plan.plan
  const [off, setOff] = useState<Set<number>>(new Set())
  const [notes, setNotes] = useState(true)
  const picked = useMemo(() => (p ? p.changes.map((_, i) => i).filter((i) => !off.has(i)) : []), [p, off])
  const doc = useMemo(() => (p && src ? applyTidyDoc(src.steps, p, picked, notes) : undefined), [p, src, picked, notes])
  const next = useMemo(() => doc?.steps ?? [], [doc])
  const rows = useMemo(() => (src ? diffSteps(src.steps, next) : []), [src, next])
  // 出题之后场景又被改过（重新录制、手改、OCR 补字）：步骤号可能对不上，不让应用
  const stale = !!(src && sc.hash && src.hash !== sc.hash)
  const imageUrl = (rel: string) =>
    api.url(`/p/${encodeURIComponent(project)}/ext/file?path=${encodeURIComponent(rel)}`)
  const shotOf = (n: number) => {
    const hint = src?.steps[n - 1]?.hint as { shot?: string } | undefined
    return typeof hint?.shot === 'string' ? hint.shot : undefined
  }

  const apply = async () => {
    if (!src || !p) return
    setBusy(true)
    try {
      const r = await ppost<{ steps: number; backup: string; keptOldBackup: boolean }>(project, 'ext/gt/tidy', {
        root: sc.root,
        path: sc.path,
        action: 'apply',
        hash: src.hash,
        plan: raw.json,
        picked,
        notes,
      })
      markApplied(messageId)
      setApplied(true)
      toast.success(
        r.keptOldBackup
          ? t('已写回，{n} 步；最早的原录制还在 {b}', { n: r.steps, b: r.backup })
          : t('已写回，{n} 步；原录制备份在 {b}', { n: r.steps, b: r.backup }),
      )
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (raw.error) return <ErrorText>{raw.error}</ErrorText>
  if (applied)
    return (
      <p className="ue:flex ue:items-center ue:gap-1.5 ue:text-footnote ue:text-fg">
        <CircleCheck className="ue:h-4 ue:w-4 ue:text-success" /> {t('已应用到 {p}', { p: sc.path ?? '' })}
      </p>
    )
  if (err || plan.error) return <ErrorText>{err || t('整理方案不对：{e}', { e: plan.error ?? '' })}</ErrorText>
  if (!src || !p)
    return (
      <p className="ue:flex ue:items-center ue:gap-1.5 ue:text-footnote ue:text-subtle">
        <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" /> {t('读场景…')}
      </p>
    )
  const noteCount = Object.keys(p.notes).length
  return (
    <div className="ue:flex ue:flex-col ue:gap-3 ue:text-footnote">
      <div className="ue:flex ue:flex-col ue:gap-1">
        <span className="ue:font-mono ue:text-caption ue:text-subtle">{sc.path}</span>
        {p.summary && <p className="ue:leading-relaxed ue:text-fg">{p.summary}</p>}
      </div>
      {stale && (
        <ErrorText>{t('场景在这次分析之后被改过，步骤号可能对不上：回 GameTest 页重新点「整理成流程」')}</ErrorText>
      )}
      {p.review.length > 0 && (
        <section className="ue:flex ue:flex-col ue:gap-1.5">
          <h3 className="ue:text-caption ue:font-medium ue:text-subtle">{t('按代码看出的问题（只提示，不改）')}</h3>
          {p.review.map((r, i) => (
            <p key={i} className="ue:flex ue:items-start ue:gap-1.5 ue:leading-relaxed">
              {r.level === 'warn' ? (
                <TriangleAlert className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-warning" />
              ) : (
                <Info className="ue:mt-0.5 ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
              )}
              <span className="ue:min-w-0 ue:text-fg">
                {r.step !== undefined && <span className="ue:mr-1 ue:text-subtle">#{r.step}</span>}
                {r.text}
              </span>
            </p>
          ))}
        </section>
      )}
      <section className="ue:flex ue:flex-col ue:gap-1.5">
        <h3 className="ue:text-caption ue:font-medium ue:text-subtle">{t('改动（勾上的才应用）')}</h3>
        {p.changes.map((c, i) => {
          const shot = shotOf(firstStep(c))
          return (
            <label
              key={i}
              className="ue:flex ue:cursor-pointer ue:items-start ue:gap-2 ue:rounded-lg ue:border ue:border-line ue:px-2.5 ue:py-2"
            >
              <input
                type="checkbox"
                className="ue:mt-0.5"
                checked={!off.has(i)}
                onChange={(e) =>
                  setOff((s) => {
                    const n = new Set(s)
                    if (e.target.checked) n.delete(i)
                    else n.add(i)
                    return n
                  })
                }
              />
              <span className="ue:flex ue:min-w-0 ue:flex-1 ue:flex-col ue:gap-0.5">
                <span className="ue:text-fg">{c.what}</span>
                <span className="ue:text-caption ue:text-subtle">{opLabel(c)}</span>
              </span>
              {shot && <ShotImage src={imageUrl(shot)} alt={t('录制截图')} className="ue:w-24 ue:shrink-0" />}
            </label>
          )
        })}
        {noteCount > 0 && (
          <label className="ue:flex ue:cursor-pointer ue:items-center ue:gap-2 ue:px-2.5">
            <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />
            <span className="ue:text-fg">{t('给 {n} 步写上说明', { n: noteCount })}</span>
          </label>
        )}
      </section>
      <section className="ue:flex ue:flex-col ue:gap-1.5">
        <h3 className="ue:text-caption ue:font-medium ue:text-subtle">
          {t('应用后：{a} 步 → {b} 步', { a: src.steps.length, b: next.length })}
        </h3>
        {doc && <FlowExtras doc={doc} />}
        <div className="ue:flex ue:flex-col ue:overflow-hidden ue:rounded-lg ue:border ue:border-line">
          {rows.map((r, i) => {
            const def = (r.kind === 'del' ? src.steps[r.a] : next[r.b]) as StepDef
            const sum = rowSummary({ def })
            return (
              <div
                key={i}
                className={cn(
                  'ue:grid ue:grid-cols-[14px_minmax(0,1fr)] ue:items-center ue:gap-2 ue:border-b ue:border-line/55 ue:px-2 ue:py-1 ue:last:border-b-0',
                  r.kind === 'del' && 'ue:bg-danger/8 ue:text-danger ue:line-through ue:decoration-danger/50',
                  r.kind === 'add' && 'ue:bg-success/9',
                )}
              >
                <span className="ue:text-center ue:font-mono ue:text-subtle">
                  {r.kind === 'del' ? '−' : r.kind === 'add' ? '+' : ''}
                </span>
                <span className="ue:min-w-0 ue:truncate">
                  <span className="ue:mr-2 ue:font-mono ue:text-fg">{def.action}</span>
                  <span className="ue:text-fg">{sum.note ?? ''}</span>
                  <span className="ue:ml-2 ue:text-subtle">{sum.human ?? sum.target ?? ''}</span>
                </span>
              </div>
            )
          })}
        </div>
      </section>
      <div className="ue:flex ue:items-center ue:gap-2">
        <span className="ue:min-w-0 ue:flex-1 ue:text-caption ue:text-subtle">
          {src.backup
            ? t('已有原录制备份 {b}，应用不会覆盖它', { b: src.backup })
            : t('应用时原录制备份成 .json.bak，GameTest 页可以恢复')}
        </span>
        <ui.Button
          size="sm"
          disabled={busy || stale || (!picked.length && !(notes && noteCount))}
          onClick={() => void apply()}
        >
          {t('应用到场景')}
        </ui.Button>
      </div>
    </div>
  )
}

/** 「整理成流程」带出的守护和参数：不在步骤列表里，单独列一行 */
function FlowExtras({ doc }: { doc: TidyResult }) {
  const params = Object.keys(doc.params)
  const parts = [
    doc.guards.length ? t('本脚本守护 {n} 个', { n: doc.guards.length }) : '',
    doc.globalGuards.length ? t('全局守护 {n} 个（写进场景根 _settings.json）', { n: doc.globalGuards.length }) : '',
    params.length ? t('参数 {k}', { k: params.map((k) => '$' + k).join('、') }) : '',
  ].filter(Boolean)
  if (!parts.length) return null
  return <p className="ue:text-caption ue:text-subtle">{parts.join(' · ')}</p>
}
