// 截帧弹窗的播放控制条：像视频播放器一样浮在画面下方（用户 2026-11-07 要的：按钮和进度条都悬浮在画面上，画面才能更大）。
// 上面一行是进度条（截下来的帧标在上面、截帧范围画成高亮的一段、两端把手可以拖），
// 下面一行左边是上一帧 · 播放 / 暂停 · 下一帧和时间，中间设范围的起点终点，右边是截取当前帧和帧播放。
import { useRef, useState } from 'react'
import { Camera, ChevronLeft, ChevronRight, Film, Loader2, Pause, Play, X } from 'lucide-react'
import { RANGE_MIN, timeText, type VideoFrame, type VideoRange } from '@shared/video'
import { t } from '@shared/i18n'
import { cn } from '@/lib/utils'

/** 浮在画面上的按钮：深色半透明底上的白色图标 */
const glass =
  'vd:grid vd:cursor-pointer vd:place-items-center vd:rounded-full vd:text-white/90 vd:transition-colors vd:hover:bg-white/15 vd:hover:text-white vd:disabled:cursor-not-allowed vd:disabled:opacity-35 vd:disabled:hover:bg-transparent vd:focus-visible:ring-2 vd:focus-visible:ring-white/70 vd:focus-visible:outline-none'
const pill =
  'vd:inline-flex vd:h-8 vd:cursor-pointer vd:items-center vd:gap-1.5 vd:rounded-full vd:px-3 vd:text-footnote vd:text-white/90 vd:transition-colors vd:hover:bg-white/15 vd:hover:text-white vd:disabled:cursor-not-allowed vd:disabled:opacity-35 vd:disabled:hover:bg-transparent vd:focus-visible:ring-2 vd:focus-visible:ring-white/70 vd:focus-visible:outline-none'

export function PlayerBar(p: {
  cur: number
  duration: number
  frames: VideoFrame[]
  viewId: string | null
  range: VideoRange | null
  playing: boolean
  loading: boolean
  sliding: boolean
  noPlayer: boolean
  busy: boolean
  onSeek: (t: number) => void
  onFrame: (f: VideoFrame) => void
  onRange: (r: VideoRange) => void
  onPrev: () => void
  onNext: () => void
  onPlay: () => void
  onSlides: () => void
  onSetIn: () => void
  onSetOut: () => void
  onClearRange: () => void
  onCapture: () => void
}) {
  const hasFrames = p.frames.length > 0
  return (
    <div className="vd:flex vd:flex-col vd:gap-1.5 vd:px-4 vd:pt-10 vd:pb-3">
      <Scrubber {...p} />
      <div className="vd:flex vd:items-center vd:gap-1">
        <button
          type="button"
          className={cn(glass, 'vd:h-9 vd:w-9')}
          onClick={p.onPrev}
          disabled={!hasFrames}
          aria-label={t('上一帧')}
          title={t('上一帧（←）')}
        >
          <ChevronLeft className="vd:h-5 vd:w-5" />
        </button>
        <button
          type="button"
          className={cn(glass, 'vd:h-10 vd:w-10 vd:bg-white/10')}
          onClick={p.onPlay}
          disabled={p.noPlayer}
          aria-label={p.playing ? t('暂停') : t('播放')}
          title={p.noPlayer ? t('浏览器放不了这个格式') : p.playing ? t('暂停（空格）') : t('播放（空格）')}
        >
          {p.playing && p.loading ? (
            <Loader2 className="vd:h-5 vd:w-5 vd:animate-spin" />
          ) : p.playing ? (
            <Pause className="vd:h-5 vd:w-5 vd:fill-current" />
          ) : (
            <Play className="vd:ml-0.5 vd:h-5 vd:w-5 vd:fill-current" />
          )}
        </button>
        <button
          type="button"
          className={cn(glass, 'vd:h-9 vd:w-9')}
          onClick={p.onNext}
          disabled={!hasFrames}
          aria-label={t('下一帧')}
          title={t('下一帧（→）')}
        >
          <ChevronRight className="vd:h-5 vd:w-5" />
        </button>
        <span className="vd:ml-2 vd:font-mono vd:text-footnote vd:text-white/90 vd:tabular-nums">
          {timeText(p.cur)}
          <span className="vd:text-white/50"> / {timeText(p.duration)}</span>
        </span>

        <span className="vd:mx-2 vd:h-4 vd:w-px vd:bg-white/20" aria-hidden />
        <button
          type="button"
          className={pill}
          onClick={p.onSetIn}
          disabled={p.busy}
          title={t('把当前位置设为起点（I）')}
        >
          <span className="vd:font-mono vd:text-micro vd:text-white/60">I</span>
          {t('起点')}
        </button>
        <button
          type="button"
          className={pill}
          onClick={p.onSetOut}
          disabled={p.busy}
          title={t('把当前位置设为终点（O）')}
        >
          <span className="vd:font-mono vd:text-micro vd:text-white/60">O</span>
          {t('终点')}
        </button>
        {p.range && (
          <span className="vd:inline-flex vd:h-7 vd:items-center vd:gap-1 vd:rounded-full vd:bg-accent/85 vd:pr-1 vd:pl-2.5 vd:font-mono vd:text-micro vd:text-white vd:tabular-nums">
            {timeText(p.range.start)} – {timeText(p.range.end)}
            <button
              type="button"
              onClick={p.onClearRange}
              disabled={p.busy}
              aria-label={t('清除范围')}
              title={t('清除范围')}
              className="vd:grid vd:h-5 vd:w-5 vd:cursor-pointer vd:place-items-center vd:rounded-full vd:hover:bg-white/20"
            >
              <X className="vd:h-3 vd:w-3" />
            </button>
          </span>
        )}

        <span className="vd:flex-1" />
        <button
          type="button"
          className={pill}
          onClick={p.onSlides}
          disabled={!hasFrames}
          aria-pressed={p.sliding}
          title={t('一张一张放截下来的帧')}
        >
          {p.sliding ? <Pause className="vd:h-3.5 vd:w-3.5" /> : <Film className="vd:h-3.5 vd:w-3.5" />}
          {p.sliding ? t('停止帧播放') : t('帧播放')}
        </button>
        <button
          type="button"
          onClick={p.onCapture}
          disabled={p.busy}
          title={t('截取当前位置（K）')}
          className="vd:ml-1 vd:inline-flex vd:h-9 vd:cursor-pointer vd:items-center vd:gap-1.5 vd:rounded-full vd:bg-white vd:px-4 vd:text-body vd:font-medium vd:text-black vd:shadow-sm vd:transition-opacity vd:hover:opacity-90 vd:disabled:cursor-not-allowed vd:disabled:opacity-40 vd:focus-visible:ring-2 vd:focus-visible:ring-white/70 vd:focus-visible:outline-none"
        >
          <Camera className="vd:h-4 vd:w-4" />
          {t('截取当前帧')}
        </button>
      </div>
    </div>
  )
}

/**
 * 进度条：点、拖都能跳到那一刻（自己处理指针，不用原生 range：原生的轨道画不了帧标记和范围）。
 * 悬停时轨道变粗、显示那一刻的时间；截下来的帧是轨道上方的小刻度（手动强调色），点刻度看那一帧；
 * 截帧范围是轨道上一段强调色，两端的把手能拖，范围外的刻度变淡
 */
function Scrubber(p: {
  cur: number
  duration: number
  frames: VideoFrame[]
  viewId: string | null
  range: VideoRange | null
  onSeek: (t: number) => void
  onFrame: (f: VideoFrame) => void
  onRange: (r: VideoRange) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  /** 正在拖什么：进度、范围起点、范围终点 */
  const drag = useRef<'seek' | 'start' | 'end' | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const pct = (x: number) => `${p.duration > 0 ? (Math.min(Math.max(0, x), p.duration) / p.duration) * 100 : 0}%`
  const timeAt = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r || !r.width) return 0
    return Math.min(Math.max(0, ((clientX - r.left) / r.width) * p.duration), p.duration)
  }
  const apply = (which: 'seek' | 'start' | 'end', at: number) => {
    if (which === 'seek') return p.onSeek(at)
    if (!p.range) return
    // 两端之间至少留 RANGE_MIN，拖过头时停在另一端旁边，不对调
    p.onRange(
      which === 'start'
        ? { start: Math.min(at, p.range.end - RANGE_MIN), end: p.range.end }
        : { start: p.range.start, end: Math.max(at, p.range.start + RANGE_MIN) },
    )
  }
  const down = (which: 'seek' | 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation()
    box.current?.setPointerCapture(e.pointerId)
    drag.current = which
    apply(which, timeAt(e.clientX))
  }
  const handle = (which: 'start' | 'end') => (
    <button
      type="button"
      aria-label={which === 'start' ? t('截帧范围起点') : t('截帧范围终点')}
      title={`${which === 'start' ? t('起点') : t('终点')} · ${timeText(which === 'start' ? p.range!.start : p.range!.end)}`}
      style={{ left: pct(which === 'start' ? p.range!.start : p.range!.end) }}
      onPointerDown={down(which)}
      onKeyDown={(e) => {
        // 键盘微调：← → 每次 0.1 秒（Shift 1 秒）
        const d = (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0) * (e.shiftKey ? 1 : 0.1)
        if (!d || !p.range) return
        e.preventDefault()
        e.stopPropagation()
        apply(which, (which === 'start' ? p.range.start : p.range.end) + d)
      }}
      className="vd:absolute vd:top-1/2 vd:z-10 vd:h-4 vd:w-2 vd:-translate-x-1/2 vd:-translate-y-1/2 vd:cursor-ew-resize vd:touch-none vd:rounded-full vd:border-2 vd:border-white vd:bg-accent vd:shadow vd:focus-visible:ring-2 vd:focus-visible:ring-white vd:focus-visible:outline-none"
    />
  )
  return (
    <div className="vd:relative">
      {/* 帧刻度：轨道上方一排，点了看那一帧 */}
      <div className="vd:relative vd:h-3">
        {p.frames.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => p.onFrame(f)}
            title={`${f.source === 'manual' ? t('手动') : t('自动')} · ${timeText(f.time)}`}
            aria-label={t('看 {time} 的帧', { time: timeText(f.time) })}
            style={{ left: pct(f.time) }}
            className={cn(
              'vd:absolute vd:top-0 vd:h-2.5 vd:w-1 vd:-translate-x-1/2 vd:cursor-pointer vd:rounded-full vd:transition-transform vd:hover:scale-y-125',
              f.source === 'manual' ? 'vd:bg-accent' : 'vd:bg-white/80',
              p.range && (f.time < p.range.start || f.time > p.range.end) && 'vd:opacity-35',
              p.viewId === f.id && 'vd:ring-2 vd:ring-white',
            )}
          />
        ))}
      </div>
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label={t('视频位置')}
        aria-valuemin={0}
        aria-valuemax={Math.round(p.duration * 10) / 10}
        aria-valuenow={Math.round(p.cur * 10) / 10}
        aria-valuetext={timeText(p.cur)}
        className="vd:group vd:relative vd:flex vd:h-4 vd:cursor-pointer vd:touch-none vd:items-center vd:outline-none"
        onPointerDown={down('seek')}
        onPointerMove={(e) => {
          setHover(timeAt(e.clientX))
          if (drag.current) apply(drag.current, timeAt(e.clientX))
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          const d = (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0) * (e.shiftKey ? 5 : 1)
          if (!d) return
          // 方向键默认是上一帧 / 下一帧（弹窗的快捷键）；焦点在进度条上时改成前后跳 1 秒（Shift 5 秒）
          e.preventDefault()
          e.stopPropagation()
          p.onSeek(Math.min(Math.max(0, p.cur + d), p.duration))
        }}
      >
        {/* 截帧范围：比轨道高一圈的强调色底，播放进度盖过去时上下沿照样看得见 */}
        {p.range && (
          <div
            className="vd:pointer-events-none vd:absolute vd:top-1/2 vd:h-2.5 vd:-translate-y-1/2 vd:rounded-full vd:bg-accent/80"
            style={{ left: pct(p.range.start), width: `calc(${pct(p.range.end)} - ${pct(p.range.start)})` }}
          />
        )}
        <div className="vd:relative vd:h-1 vd:w-full vd:overflow-hidden vd:rounded-full vd:bg-white/25 vd:transition-[height] vd:group-hover:h-1.5 vd:group-focus-visible:h-1.5">
          <div className="vd:absolute vd:inset-y-0 vd:left-0 vd:bg-white" style={{ width: pct(p.cur) }} />
        </div>
        {/* 播放头 */}
        <div
          className="vd:pointer-events-none vd:absolute vd:top-1/2 vd:h-3 vd:w-3 vd:-translate-x-1/2 vd:-translate-y-1/2 vd:scale-0 vd:rounded-full vd:bg-white vd:shadow vd:transition-transform vd:group-hover:scale-100 vd:group-focus-visible:scale-100"
          style={{ left: pct(p.cur) }}
        />
        {p.range && handle('start')}
        {p.range && handle('end')}
        {hover !== null && (
          <span
            className="vd:pointer-events-none vd:absolute vd:bottom-5 vd:-translate-x-1/2 vd:rounded-md vd:bg-black/80 vd:px-1.5 vd:py-0.5 vd:font-mono vd:text-micro vd:text-white vd:tabular-nums"
            style={{ left: pct(hover) }}
          >
            {timeText(hover)}
          </span>
        )}
      </div>
    </div>
  )
}
