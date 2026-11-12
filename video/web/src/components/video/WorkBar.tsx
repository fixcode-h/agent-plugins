// 截帧弹窗底部的进度：自动截帧（先分析画面、再一张张截）、增强（做完几张）、截取 / 清除，带取消
import { Loader2 } from 'lucide-react'
import type { AutoProgress } from '@shared/video'
import { t } from '@shared/i18n'
import { Button } from '@/components/ui/button'

/** 正在跑的操作；enhance 的 ids 是这一批要处理的帧，progress 是服务端报的进度（哪几张在做、哪几张做完） */
export type Work =
  | { kind: 'manual' }
  | { kind: 'clear' }
  | { kind: 'auto'; progress: AutoProgress | null }
  | { kind: 'enhance'; ids: string[]; progress: AutoProgress | null }

/** 文案和进度（0~1；不知道进度时为 null，进度条来回走） */
export function workText(w: Work): { text: string; ratio: number | null } {
  if (w.kind === 'manual') return { text: t('截取中'), ratio: null }
  if (w.kind === 'clear') return { text: t('处理中'), ratio: null }
  if (w.kind === 'enhance') {
    const done = w.progress?.stage === 'enhance' ? w.progress.done : 0
    return {
      text: t('增强中，做完 {i}/{n} 张', { i: done, n: w.ids.length }),
      ratio: done / Math.max(1, w.ids.length),
    }
  }
  const p = w.progress
  if (!p) return { text: t('准备自动截帧'), ratio: null }
  // 分析画面占进度条的前 70%，截图占后 30%：分析要整段解码，是最慢的一步
  if (p.stage === 'analyze')
    return { text: t('分析画面 {pct}%', { pct: Math.round(p.done * 100) }), ratio: p.done * 0.7 }
  return {
    text: t('截取第 {i}/{n} 张', { i: Math.min(p.done + 1, p.total), n: p.total }),
    ratio: 0.7 + (0.3 * p.done) / Math.max(1, p.total),
  }
}

export function WorkBar({ work, onCancel }: { work: Work; onCancel: () => void }) {
  const { text, ratio } = workText(work)
  const cancellable = work.kind === 'auto' || work.kind === 'enhance'
  return (
    <div className="vd:flex vd:min-w-0 vd:items-center vd:gap-2.5" role="status" aria-live="polite">
      <Loader2 className="vd:h-3.5 vd:w-3.5 vd:shrink-0 vd:animate-spin vd:text-muted" />
      <span className="vd:shrink-0 vd:text-footnote vd:text-fg vd:tabular-nums">{text}</span>
      <div
        className="vd:relative vd:h-1.5 vd:w-40 vd:shrink vd:overflow-hidden vd:rounded-full vd:bg-line"
        role="progressbar"
        aria-label={text}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
      >
        {ratio === null ? (
          <div className="vd:absolute vd:inset-y-0 vd:w-1/3 vd:animate-[work-slide_1.2s_ease-in-out_infinite] vd:rounded-full vd:bg-accent" />
        ) : (
          <div
            className="vd:absolute vd:inset-y-0 vd:left-0 vd:rounded-full vd:bg-accent vd:transition-[width] vd:duration-300"
            style={{ width: `${Math.max(2, ratio * 100)}%` }}
          />
        )}
      </div>
      {cancellable && (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('停止')}
        </Button>
      )}
    </div>
  )
}
