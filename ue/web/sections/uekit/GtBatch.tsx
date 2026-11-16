import { CircleCheck, CircleDashed, CircleMinus, CircleStop, CircleX, Layers, Loader2, X } from 'lucide-react'
import { h, t } from '../../host.ts'
import { ms } from './GtStepDetail.tsx'

/** 批量运行（gt.run tag= / scenarios=）的进度和结果：作业状态和 gt.job 事件里的 batch */
export interface GtBatchItem {
  scenario: string
  name?: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'skipped' | string
  runId?: string
  message?: string
  failedStep?: number
  durationMs?: number
}

export interface GtBatch {
  id: string
  label?: string
  active: boolean
  total: number
  current?: number
  passed: number
  failed: number
  skipped?: number
  items?: GtBatchItem[]
}

function ItemIcon({ s }: { s: string }) {
  if (s === 'running') return <Loader2 className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:animate-spin ue:text-warning" />
  if (s === 'passed') return <CircleCheck className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-success" />
  if (s === 'failed' || s === 'error') return <CircleX className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-danger" />
  if (s === 'skipped') return <CircleMinus className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
  return <CircleDashed className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
}

/**
 * GameTest 页右栏顶上的批量运行条：标签、第几个 / 共几个、通过和失败数、进度条；下面一行一个场景，
 * 点一行打开那个场景看它这次的每一步。跑着时右边是「停止」（整批取消），跑完了是关掉
 */
export function GtBatchBar({
  batch,
  onOpen,
  onStop,
  onClose,
}: {
  batch: GtBatch
  onOpen?: (scenario: string) => void
  onStop?: () => void
  onClose?: () => void
}) {
  const { ui, cn } = h()
  const items = batch.items ?? []
  const done = items.filter((x) => !['pending', 'running'].includes(x.status)).length
  const running = items.findIndex((x) => x.status === 'running')
  return (
    <section className="ue:flex ue:max-h-[40%] ue:min-h-0 ue:shrink-0 ue:flex-col ue:border-b ue:border-line">
      <header
        className={cn(
          'ue:flex ue:flex-wrap ue:items-center ue:gap-x-3 ue:gap-y-1 ue:px-4 ue:py-2.5 ue:text-footnote',
          !batch.active && (batch.failed ? 'ue:bg-danger/7' : 'ue:bg-success/7'),
        )}
      >
        {batch.active ? (
          <Loader2 className="ue:h-4 ue:w-4 ue:shrink-0 ue:animate-spin ue:text-warning" />
        ) : (
          <Layers className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-subtle" />
        )}
        <span className="ue:font-medium ue:text-fg">
          {batch.active
            ? t('批量运行 · 第 {n} / {m} 个', {
                n: Math.min((running >= 0 ? running : done) + 1, batch.total),
                m: batch.total,
              })
            : t('批量运行完成 · {m} 个场景', { m: batch.total })}
        </span>
        {batch.label && <span className="ue:truncate ue:font-mono ue:text-subtle">{batch.label}</span>}
        <span className="ue:text-success ue:tabular-nums">{t('通过 {n}', { n: batch.passed })}</span>
        {batch.failed > 0 && (
          <span className="ue:text-danger ue:tabular-nums">{t('失败 {n}', { n: batch.failed })}</span>
        )}
        {(batch.skipped ?? 0) > 0 && (
          <span className="ue:text-subtle ue:tabular-nums">{t('没跑 {n}', { n: batch.skipped ?? 0 })}</span>
        )}
        <div className="ue:h-1 ue:min-w-12 ue:flex-1 ue:overflow-hidden ue:rounded-full ue:bg-sel">
          <div
            className={cn('ue:h-full', batch.failed ? 'ue:bg-danger' : 'ue:bg-run')}
            style={{ width: `${batch.total ? (done / batch.total) * 100 : 0}%` }}
          />
        </div>
        {batch.active
          ? onStop && (
              <ui.Button size="sm" variant="secondary" onClick={onStop}>
                <CircleStop className="ue:h-3.5 ue:w-3.5" /> {t('停止')}
              </ui.Button>
            )
          : onClose && <ui.IconButton icon={X} size="sm" label={t('关掉批量结果')} onClick={onClose} />}
      </header>
      {items.length > 0 && (
        <div className="ue:min-h-0 ue:overflow-auto">
          {items.map((x) => (
            <button
              key={x.scenario}
              type="button"
              onClick={() => onOpen?.(x.scenario)}
              className="ue:grid ue:h-8 ue:w-full ue:cursor-pointer ue:grid-cols-[18px_minmax(0,1fr)_auto] ue:items-center ue:gap-2 ue:border-t ue:border-line/55 ue:px-4 ue:text-left ue:text-footnote ue:hover:bg-sel/50"
            >
              <ItemIcon s={x.status} />
              <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
                <span className="ue:truncate ue:text-fg">{x.name || x.scenario}</span>
                {x.message ? (
                  <span className="ue:min-w-0 ue:truncate ue:text-danger">
                    {x.failedStep ? t('第 {n} 步：{m}', { n: x.failedStep, m: x.message }) : x.message}
                  </span>
                ) : (
                  x.name && <span className="ue:min-w-0 ue:truncate ue:font-mono ue:text-subtle">{x.scenario}</span>
                )}
              </span>
              <span className="ue:text-caption ue:text-subtle ue:tabular-nums">{ms(x.durationMs)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
