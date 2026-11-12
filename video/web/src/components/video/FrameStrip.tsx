// 截帧弹窗画面下方那排截下来的帧（像剪辑软件的胶片条）：点一张在上面看，双击全屏看大图，左上角勾选决定发不发，悬停出删除。
// 缩略图下沿写时间，右下角标「手动 / 增强 / 标注」；增强时正在处理的盖一层转圈，排队的标「等待」，做完的打勾。
// 上面一行是张数、选中几张和全选 / 全不选（用户 2026-11-07 要的重新设计：画面要大，帧条压成一行窄条）
import { Check, Loader2, PenLine, X } from 'lucide-react'
import { timeText, type VideoFrame } from '@shared/video'
import { t } from '@shared/i18n'
import { cn } from '@/lib/utils'
import { frameUrl } from '@/lib/video-api'

/** 批量增强时每张帧的状态 */
export interface Working {
  running: Set<string>
  queued: Set<string>
  finished: Set<string>
}
export const IDLE: Working = { running: new Set(), queued: new Set(), finished: new Set() }

export function FrameStrip({
  frames,
  viewId,
  skipped,
  original,
  working,
  onView,
  onZoom,
  onToggle,
  onAll,
  onRemove,
}: {
  frames: VideoFrame[]
  viewId: string | null
  skipped: Set<string>
  original: boolean
  working: Working
  onView: (f: VideoFrame) => void
  /** 双击：全屏看大图 */
  onZoom: (f: VideoFrame) => void
  onToggle: (f: VideoFrame) => void
  /** 全选 / 全不选 */
  onAll: (on: boolean) => void
  onRemove: (f: VideoFrame) => void
}) {
  const chosen = frames.filter((f) => !skipped.has(f.id)).length
  return (
    <div className="vd:flex vd:shrink-0 vd:flex-col vd:gap-1.5 vd:border-t vd:border-line vd:bg-panel vd:px-3 vd:pt-2 vd:pb-2.5">
      <div className="vd:flex vd:h-5 vd:items-center vd:gap-2 vd:text-footnote">
        <span className="vd:font-medium vd:text-fg">{t('截下来的帧')}</span>
        {frames.length > 0 && (
          <>
            <span className="vd:text-subtle vd:tabular-nums">
              {t('{n} 张，选中 {m} 张', { n: frames.length, m: chosen })}
            </span>
            <span className="vd:flex-1" />
            <button
              type="button"
              className="vd:cursor-pointer vd:rounded vd:px-1 vd:text-muted vd:hover:text-fg"
              onClick={() => onAll(chosen < frames.length)}
            >
              {chosen < frames.length ? t('全选') : t('全不选')}
            </button>
          </>
        )}
      </div>
      {!frames.length ? (
        <div className="vd:grid vd:h-[72px] vd:place-items-center vd:rounded-lg vd:border vd:border-dashed vd:border-line-strong vd:px-4 vd:text-center vd:text-footnote vd:text-subtle">
          {t('还没有截帧：播放到要看的地方点「截取当前帧」（K），或者在右边点「自动截帧」')}
        </div>
      ) : (
        <div className="vd:flex vd:gap-1.5 vd:overflow-x-auto vd:pb-0.5" role="list" aria-label={t('截下来的帧')}>
          {frames.map((f) => {
            const on = !skipped.has(f.id)
            const file = f.enhanced && !original ? f.enhanced.file : f.file
            const doing = working.running.has(f.id)
            return (
              <div key={f.id} role="listitem" className="vd:group vd:relative vd:h-[72px] vd:w-[128px] vd:shrink-0">
                <button
                  type="button"
                  onClick={() => onView(f)}
                  onDoubleClick={() => onZoom(f)}
                  aria-label={t('看 {time} 的帧', { time: timeText(f.time) })}
                  title={t('双击看大图')}
                  className={cn(
                    'vd:relative vd:h-full vd:w-full vd:cursor-pointer vd:overflow-hidden vd:rounded-md vd:bg-black vd:outline-offset-1 vd:transition-[opacity,box-shadow]',
                    viewId === f.id || doing
                      ? 'vd:ring-2 vd:ring-accent'
                      : 'vd:ring-1 vd:ring-line vd:hover:ring-line-strong',
                    !on && 'vd:opacity-40 vd:hover:opacity-70',
                  )}
                >
                  <img
                    src={frameUrl(file, true)}
                    alt=""
                    className="vd:h-full vd:w-full vd:object-cover"
                    loading="lazy"
                  />
                  <span className="vd:pointer-events-none vd:absolute vd:inset-x-0 vd:bottom-0 vd:flex vd:items-end vd:gap-1 vd:bg-gradient-to-t vd:from-black/75 vd:to-transparent vd:px-1.5 vd:pt-4 vd:pb-1">
                    <span className="vd:font-mono vd:text-micro vd:leading-none vd:text-white vd:tabular-nums">
                      {timeText(f.time)}
                    </span>
                    <span className="vd:flex-1" />
                    {f.shapes?.length ? (
                      <PenLine className="vd:h-3 vd:w-3 vd:text-white" aria-label={t('有标注')} />
                    ) : null}
                    {f.enhanced && !original && (
                      <span className="vd:rounded-sm vd:bg-white/20 vd:px-1 vd:text-micro vd:leading-3.5 vd:text-white">
                        {t('增强')}
                      </span>
                    )}
                    {f.source === 'manual' && (
                      <span className="vd:rounded-sm vd:bg-accent vd:px-1 vd:text-micro vd:leading-3.5 vd:text-white">
                        {t('手动')}
                      </span>
                    )}
                  </span>
                  {doing && (
                    <span className="vd:absolute vd:inset-0 vd:flex vd:items-center vd:justify-center vd:gap-1 vd:bg-black/55 vd:text-micro vd:text-white">
                      <Loader2 className="vd:h-3.5 vd:w-3.5 vd:animate-spin" />
                      {t('处理中')}
                    </span>
                  )}
                  {working.queued.has(f.id) && (
                    <span className="vd:absolute vd:top-1 vd:right-1 vd:rounded-sm vd:bg-black/65 vd:px-1 vd:text-micro vd:leading-4 vd:text-white">
                      {t('等待')}
                    </span>
                  )}
                  {working.finished.has(f.id) && (
                    <span className="vd:absolute vd:top-1 vd:right-1 vd:grid vd:h-4 vd:w-4 vd:place-items-center vd:rounded-full vd:bg-success vd:text-white">
                      <Check className="vd:h-3 vd:w-3" strokeWidth={3} />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={t('发送 {time} 的帧', { time: timeText(f.time) })}
                  title={on ? t('发送这一帧（点一下不发）') : t('不发这一帧（点一下发送）')}
                  onClick={() => onToggle(f)}
                  className={cn(
                    'vd:absolute vd:top-1 vd:left-1 vd:grid vd:h-4 vd:w-4 vd:cursor-pointer vd:place-items-center vd:rounded-sm vd:border vd:shadow-sm',
                    on ? 'vd:border-accent vd:bg-accent vd:text-on-accent' : 'vd:border-white/80 vd:bg-black/40',
                  )}
                >
                  {on && <Check className="vd:h-3 vd:w-3" strokeWidth={3} />}
                </button>
                {!working.queued.has(f.id) && !working.finished.has(f.id) && (
                  <button
                    type="button"
                    onClick={() => onRemove(f)}
                    aria-label={t('删除这一帧')}
                    title={t('删除这一帧')}
                    className="vd:absolute vd:top-1 vd:right-1 vd:grid vd:h-5 vd:w-5 vd:cursor-pointer vd:place-items-center vd:rounded-full vd:bg-black/65 vd:text-white vd:opacity-0 vd:group-hover:opacity-100 vd:hover:bg-black/85 vd:focus-visible:opacity-100"
                  >
                    <X className="vd:h-3 vd:w-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
