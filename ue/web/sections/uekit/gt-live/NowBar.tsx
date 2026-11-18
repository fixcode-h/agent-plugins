import { Loader2, ScanEye } from 'lucide-react'
import { h, t } from '../../../host.ts'
import type { NowState } from './use-cond-now.ts'
import { watchIntervalMs } from './use-watch.ts'

/** 「连着游戏、一直在刷新」的小标记：一个慢慢明暗的点 + 刷新间隔；查询出错时换成错误原因 */
export function NowBadge({ error }: { error?: string }) {
  const { cn } = h()
  return (
    <span
      className={cn(
        'ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:text-caption',
        error ? 'ue:text-danger' : 'ue:text-subtle',
      )}
      title={error || undefined}
    >
      <span
        className={cn(
          'ue:h-1.5 ue:w-1.5 ue:shrink-0 ue:rounded-full',
          error ? 'ue:bg-danger' : 'ue:bg-success ue:motion-safe:animate-pulse',
        )}
      />
      <span className="ue:truncate">{error || t('连着游戏 · 每 {s} 秒刷新', { s: watchIntervalMs() / 1000 })}</span>
    </span>
  )
}

/**
 * 条件组下面那一条「此刻：成立 / 不成立」（定稿 9.2）：连着游戏时一直刷新；GameTest 太旧时给「现在核对」按钮问一次
 */
export function NowBar({ now, holds }: { now: NowState<unknown>; holds?: boolean }) {
  const { ui } = h()
  if (now.mode === 'off') return null
  return (
    <div className="ue:flex ue:min-h-8 ue:items-center ue:gap-2 ue:rounded-(--c-row-radius) ue:bg-hover ue:px-2.5 ue:py-1 ue:text-footnote">
      {now.mode === 'manual' && (
        <ui.Button size="sm" variant="ghost" disabled={now.checking} onClick={now.check}>
          {now.checking ? (
            <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
          ) : (
            <ScanEye className="ue:h-3.5 ue:w-3.5" />
          )}
          {t('现在核对')}
        </ui.Button>
      )}
      {holds !== undefined && (
        <span className={holds ? 'ue:shrink-0 ue:text-success' : 'ue:shrink-0 ue:text-danger'}>
          {holds ? t('此刻：成立') : t('此刻：不成立')}
        </span>
      )}
      {now.mode === 'live' ? (
        <span className="ue:ml-auto ue:min-w-0">
          <NowBadge error={now.error} />
        </span>
      ) : (
        holds === undefined && <span className="ue:text-subtle">{t('问一次游戏，看此刻每条成不成立')}</span>
      )}
    </div>
  )
}
