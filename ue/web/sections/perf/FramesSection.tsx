import { ChevronDown } from 'lucide-react'
import { h, t } from '../../host.ts'
import { openMenuAt } from '@panel/web/src/components/ui/item-menu'
import { ErrorText, LinkBtn } from '../../ui.tsx'
import { FrameStrip } from './FrameStrip.tsx'
import type { LuaFrames } from './lua-trace.ts'
import { Section, Skeleton, fmtAt, fmtMs } from './parts.tsx'
import type { Bookmark, Range, TraceFrames } from './trace.ts'
import { ZoomControls } from './ZoomControls.tsx'

/**
 * trace 视图的帧条一块（从 TraceView 拆出来）：标题行左边是图例（帧时间 / 其中 Lua），右边是分析范围、
 * 「按 Lua 用时找最慢」下拉（trace 含 Lua 时才有）和缩放按钮组；下面是帧条本身。
 * 选中的帧记在这里：单击一帧、从下拉里挑一帧都选中它并让时间轴跳过去。
 */
export function FramesSection({
  frames,
  error,
  onRetry,
  duration,
  range,
  view,
  strip,
  setStrip,
  marks,
  budget,
  lua,
  selected,
  onSelect,
  onRange,
  onZoom,
}: {
  frames?: TraceFrames
  error?: string
  onRetry: () => void
  duration: number
  range?: Range
  view: Range
  strip: Range
  setStrip: (r: Range) => void
  marks: Bookmark[]
  budget: { target: number; unacceptable: number }
  lua?: LuaFrames
  selected?: number
  onSelect: (i: number) => void
  onRange: (r: Range | undefined) => void
  onZoom: (r: Range) => void
}) {
  const { cn } = h()
  const f = frames
  // 选中的帧刚好是分析范围时，范围直接写「第 n 帧」，比两个时间点好认
  const rangeText = (() => {
    if (!range) return t('整段')
    if (f && selected !== undefined && Math.abs(f.start[selected] - range.t0) < 1e-6)
      return `${t('第 {n} 帧', { n: selected })} · ${fmtMs((range.t1 - range.t0) * 1000)}`
    return `${fmtAt(range.t0)} – ${fmtAt(range.t1)} · ${fmtMs((range.t1 - range.t0) * 1000)}`
  })()
  return (
    <Section
      title={
        <span className="ue:flex ue:items-center ue:gap-3">
          {t('帧')}
          <span className="ue:flex ue:items-center ue:gap-2.5 ue:text-caption ue:font-normal ue:text-subtle">
            <Legend className="ue:bg-subtle/40" label={t('帧时间')} />
            {lua && <Legend className="ue:bg-accent/85" label={t('其中 Lua')} />}
          </span>
        </span>
      }
      aside={
        <span className="ue:flex ue:items-center ue:gap-2 ue:text-caption ue:text-subtle">
          <span className="ue:flex ue:items-center ue:gap-1">
            {t('分析范围：')}
            <span className={cn('ue:font-mono', range && 'ue:text-fg')}>{rangeText}</span>
          </span>
          {range ? (
            <LinkBtn onClick={() => onRange(undefined)}>{t('整段')}</LinkBtn>
          ) : (
            <span className="ue:hidden ue:2xl:inline">{t('左键拖动平移 · 单击看这一帧 · 右键拖选范围')}</span>
          )}
          {lua && f && <LuaSlowest frames={f} lua={lua} onPick={onSelect} onRange={onRange} />}
          <ZoomControls win={strip} duration={duration} onWin={setStrip} />
        </span>
      }
    >
      <div className="ue:px-3 ue:py-2">
        {error ? (
          <div className="ue:flex ue:items-center ue:gap-2">
            <div className="ue:min-w-0 ue:flex-1">
              <ErrorText>{t('读不到帧：{msg}', { msg: error })}</ErrorText>
            </div>
            <LinkBtn onClick={onRetry}>{t('重试')}</LinkBtn>
          </div>
        ) : f ? (
          <FrameStrip
            start={f.start}
            ms={f.ms}
            duration={duration}
            range={range}
            view={view}
            win={strip}
            onWin={setStrip}
            marks={marks}
            budget={budget}
            lua={lua}
            selected={selected}
            onFrame={onSelect}
            onRange={onRange}
            onZoom={onZoom}
          />
        ) : (
          <Skeleton rows={2} />
        )}
      </div>
    </Section>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="ue:flex ue:items-center ue:gap-1">
      <span className={h().cn('ue:inline-block ue:h-2 ue:w-2 ue:rounded-[2px]', className)} />
      {label}
    </span>
  )
}

/** 「按 Lua 用时找最慢」：列出 Lua 用时最长的 10 帧，挑一帧 = 设为分析范围并让时间轴跳过去 */
function LuaSlowest({
  frames,
  lua,
  onPick,
  onRange,
}: {
  frames: TraceFrames
  lua: LuaFrames
  onPick: (i: number) => void
  onRange: (r: Range) => void
}) {
  const pick = (i: number) => {
    onRange({ t0: frames.start[i], t1: frames.start[i] + frames.ms[i] / 1000 })
    onPick(i)
  }
  const top = () => {
    const idx: number[] = []
    for (let i = 0; i < lua.ms.length; i++) if (lua.ms[i] > 0) idx.push(i)
    return idx.sort((a, b) => lua.ms[b] - lua.ms[a]).slice(0, 10)
  }
  return (
    <button
      type="button"
      title={t('按每帧的 Lua 用时排序，挑一帧跳过去')}
      onClick={(e) => {
        const list = top()
        openMenuAt(e.currentTarget, [
          { title: t('按 Lua 用时最慢的帧') },
          ...(list.length
            ? list.map((i) => ({
                label: t('第 {n} 帧', { n: i }),
                hint: `Lua ${fmtMs(lua.ms[i])} / ${fmtMs(frames.ms[i])}`,
                onClick: () => pick(i),
              }))
            : [{ label: t('没有 Lua 用时的读数'), disabled: true, onClick: () => undefined }]),
        ])
      }}
      className="ue:inline-flex ue:h-6 ue:items-center ue:gap-1 ue:rounded-md ue:border ue:border-line ue:px-2 ue:text-caption ue:text-muted ue:transition-colors ue:hover:bg-hover ue:hover:text-fg"
    >
      {t('按 Lua 用时找最慢')}
      <ChevronDown className="ue:h-3 ue:w-3" />
    </button>
  )
}
