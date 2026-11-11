import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, RotateCcw } from 'lucide-react'
import { t } from '@shared/i18n'
import { stepOf, type RestoreState, type RestoreStep } from '@shared/restore/schema'
import { stepName } from '@shared/restore/steps'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'

/**
 * 每一步的决策卡（右栏）：这一版的结论、要你做什么、数字、要注意的、和上一版比改了什么。
 * 下面两个按钮：带着意见重新跑这一步（出新的一版），或者确认进下一步。往回翻版本只看，不回滚
 */
export function StepCardPanel({
  restore,
  step,
  busy,
  onRun,
  onConfirm,
}: {
  restore: RestoreState
  step: RestoreStep
  /** 有步骤在跑（这一步或别的） */
  busy: boolean
  onRun: (feedback: string) => void
  onConfirm: () => void
}) {
  const st = stepOf(restore, step)
  const [pick, setPick] = useState<number>()
  const [feedback, setFeedback] = useState('')
  // 出了新的一版就跳到最新那版
  useEffect(() => setPick(undefined), [st.versions.length, step])
  const v = pick !== undefined ? st.versions.find((x) => x.n === pick) : st.versions.at(-1)
  const card = v?.card
  const latest = !v || v.n === st.versions.at(-1)?.n

  return (
    <div data-restore-card={step} data-status={st.status} className="ud:flex ud:shrink-0 ud:flex-col ud:gap-3 ud:p-3">
      <div className="ud:flex ud:items-center ud:gap-2">
        <span className="ud:text-body ud:font-semibold">{stepName(step)}</span>
        {st.versions.length > 0 && (
          <div className="ud:flex ud:items-center ud:gap-0.5" role="tablist" aria-label={t('版本')}>
            {st.versions.map((x) => (
              <button
                key={x.n}
                type="button"
                role="tab"
                aria-selected={x.n === v?.n}
                onClick={() => setPick(x.n)}
                className={cn(
                  'ud:h-6 ud:cursor-pointer ud:rounded-md ud:px-1.5 ud:text-caption ud:tabular-nums ud:transition-colors',
                  x.n === v?.n ? 'ud:bg-active ud:text-fg' : 'ud:text-subtle ud:hover:bg-hover ud:hover:text-fg',
                )}
              >
                v{x.n}
              </button>
            ))}
          </div>
        )}
        <span className="ud:flex-1" />
        <StatusTag status={st.status} />
      </div>

      {st.status === 'running' && (
        <div className="ud:flex ud:items-center ud:gap-2 ud:rounded-lg ud:bg-panel ud:px-3 ud:py-2 ud:text-body ud:text-muted">
          <Loader2 className="ud:h-4 ud:w-4 ud:animate-spin" />
          {t('正在{step}…', { step: stepName(step) })}
        </div>
      )}
      {st.status === 'failed' && st.error && (
        <div
          role="alert"
          className="ud:rounded-lg ud:bg-danger/10 ud:px-3 ud:py-2 ud:text-body ud:break-words ud:text-danger"
        >
          {st.error}
        </div>
      )}
      {st.status === 'stale' && (
        <div className="ud:rounded-lg ud:bg-warning/10 ud:px-3 ud:py-2 ud:text-body ud:text-warning">
          {t('前面的步骤改过了，这一步要重新跑')}
        </div>
      )}

      {card ? (
        <div className="ud:flex ud:flex-col ud:gap-2.5">
          <p className="ud:text-body ud:leading-relaxed ud:font-medium">{card.conclusion}</p>
          {card.metrics.length > 0 && (
            <div className="ud:grid ud:grid-cols-2 ud:gap-1.5">
              {card.metrics.map((m) => (
                <div key={m.label} className="ud:rounded-lg ud:bg-panel ud:px-2.5 ud:py-1.5">
                  <div className="ud:text-caption ud:text-subtle">{m.label}</div>
                  <div
                    className={cn(
                      'ud:text-body ud:font-semibold ud:tabular-nums',
                      m.ok === false ? 'ud:text-warning' : m.ok ? 'ud:text-success' : 'ud:text-fg',
                    )}
                  >
                    {m.value}
                  </div>
                </div>
              ))}
            </div>
          )}
          {card.diff && (
            <p className="ud:text-footnote ud:text-muted">
              {t('比上一版：')}
              {card.diff}
            </p>
          )}
          {card.warnings.length > 0 && (
            <ul className="ud:flex ud:flex-col ud:gap-1">
              {card.warnings.map((w) => (
                <li key={w} className="ud:flex ud:gap-1.5 ud:text-footnote ud:text-warning">
                  <AlertTriangle className="ud:mt-0.5 ud:h-3.5 ud:w-3.5 ud:shrink-0" />
                  <span className="ud:break-words">{w}</span>
                </li>
              ))}
            </ul>
          )}
          {card.note && (
            <p className="ud:rounded-lg ud:bg-panel ud:px-2.5 ud:py-2 ud:text-footnote ud:text-muted">{card.note}</p>
          )}
          {card.todo && latest && <p className="ud:text-footnote ud:text-subtle">{card.todo}</p>}
          {v?.feedback && (
            <p className="ud:text-footnote ud:text-subtle">
              {t('这一版的意见：')}
              {v.feedback}
            </p>
          )}
        </div>
      ) : (
        st.status !== 'running' && <p className="ud:text-body ud:text-subtle">{t('这一步还没开始')}</p>
      )}

      {step !== 'source' && (
        <Textarea
          rows={3}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={t('哪里不对？写下意见再重新跑这一步（可以不写）')}
          aria-label={t('意见')}
          disabled={busy}
        />
      )}
      <div className="ud:flex ud:flex-wrap ud:justify-end ud:gap-2">
        {step !== 'source' && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              onRun(feedback)
              setFeedback('')
            }}
          >
            <RotateCcw className="ud:h-3.5 ud:w-3.5" />
            {st.versions.length ? t('重新跑这一步') : t('运行这一步')}
          </Button>
        )}
        <Button size="sm" disabled={busy || st.status !== 'review'} onClick={onConfirm} data-restore-confirm>
          <Check className="ud:h-3.5 ud:w-3.5" />
          {step === 'deliver' ? t('确认交付') : t('确认，下一步')}
        </Button>
      </div>
    </div>
  )
}

function StatusTag({ status }: { status: string }) {
  const label: Record<string, string> = {
    todo: t('未开始'),
    running: t('运行中'),
    review: t('等你确认'),
    done: t('已确认'),
    stale: t('要更新'),
    failed: t('失败'),
  }
  return (
    <span
      className={cn(
        'ud:rounded-md ud:px-1.5 ud:py-0.5 ud:text-caption',
        status === 'done'
          ? 'ud:bg-success/10 ud:text-success'
          : status === 'failed'
            ? 'ud:bg-danger/10 ud:text-danger'
            : status === 'review'
              ? 'ud:bg-accent-soft ud:text-accent-text'
              : status === 'stale'
                ? 'ud:bg-warning/10 ud:text-warning'
                : 'ud:bg-hover ud:text-subtle',
      )}
    >
      {label[status] ?? status}
    </span>
  )
}
