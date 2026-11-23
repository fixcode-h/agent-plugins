import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Film,
  Pause,
  Play,
  Repeat,
  Search,
  SkipBack,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { h, t } from '../host.ts'
import { usePane } from '@panel/web/src/components/ui/split-pane'
import { fmtSec, fmtValue, tickStep, valueAt, type AnimKey } from './keys.ts'

/**
 * 动画时间轴（共用组件；UMG 动画第一期，以后动画序列、曲线也用）：照 UE Sequencer 的简版，只读。
 * 左边轨道（对象 → 通道，当前时刻的值），右边刻度、关键帧（cubic 圆点、linear 菱形、constant 方块）、播放头；
 * 播放 / 暂停、回到开头、单帧步进、循环。播放头在刻度上或轨道空白处按住拖；点关键帧选中（外面显示它的时间、值、插值）。
 * 轨道名一栏能拖宽，宽度记在本机（和分栏同一张表）。
 */
export interface TlChannel {
  id: string
  label: string
  icon?: LucideIcon
  keys: AnimKey[]
}

export interface TlGroup {
  id: string
  label: string
  icon?: LucideIcon
  channels: TlChannel[]
}

export interface KeyRef {
  group: string
  channel: string
  index: number
}

const PAD = 12
const ROW = 'ue:h-7'

function KeyMark({ k, on, muted, onPick }: { k: AnimKey; on?: boolean; muted?: boolean; onPick?: () => void }) {
  const { cn } = h()
  const shape =
    k.interp === 'constant'
      ? 'ue:rounded-[1px]'
      : k.interp === 'linear'
        ? 'ue:rotate-45 ue:rounded-[1px]'
        : 'ue:rounded-full'
  return (
    <button
      type="button"
      tabIndex={onPick ? 0 : -1}
      title={`${fmtSec(k.time)} · ${fmtValue(k.value)} · ${k.interp}`}
      aria-label={t('关键帧 {t}', { t: fmtSec(k.time) })}
      aria-pressed={on}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onPick?.()
      }}
      className={cn(
        'ue:absolute ue:top-1/2 ue:h-2.5 ue:w-2.5 ue:-translate-x-1/2 ue:-translate-y-1/2 ue:border',
        onPick ? 'ue:cursor-pointer' : 'ue:pointer-events-none',
        muted ? 'ue:border-muted ue:bg-muted/70' : 'ue:border-warning ue:bg-warning',
        on && 'ue:ring-2 ue:ring-accent ue:ring-offset-1 ue:ring-offset-card',
        shape,
      )}
      style={{ left: 'var(--x)' }}
    />
  )
}

export function Timeline({
  title,
  aside,
  groups,
  length,
  fps = 60,
  time,
  onTime,
  playing,
  onPlaying,
  loop,
  onLoop,
  selectedKey,
  onSelectKey,
  empty,
}: {
  title: ReactNode
  aside?: ReactNode
  groups: TlGroup[]
  /** 长度（秒） */
  length: number
  fps?: number
  time: number
  onTime: (t: number) => void
  playing: boolean
  onPlaying: (on: boolean) => void
  loop: boolean
  onLoop: (on: boolean) => void
  selectedKey?: KeyRef
  onSelectKey: (k: KeyRef | undefined) => void
  /** 没有轨道时的说明 */
  empty?: ReactNode
}) {
  const { ui, cn } = h()
  const names = usePane('timeline.names', '240px', 140)
  const [q, setQ] = useState('')
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const ruler = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    const el = ruler.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const len = length > 0 ? length : 1
  const xOf = (s: number) => PAD + (Math.max(0, Math.min(len, s)) / len) * Math.max(1, w - PAD * 2)
  const timeAt = (clientX: number) => {
    const r = ruler.current?.getBoundingClientRect()
    if (!r) return 0
    const s = ((clientX - r.left - PAD) / Math.max(1, r.width - PAD * 2)) * len
    return Math.max(0, Math.min(len, Math.round(s * fps) / fps))
  }

  // 播放：按真实时间往前走，到头了循环或停
  const now = useRef(time)
  now.current = time
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let id = 0
    const step = (ts: number) => {
      let next = now.current + (ts - last) / 1000
      last = ts
      if (next >= len) {
        if (loop) next %= len
        else {
          onTime(len)
          onPlaying(false)
          return
        }
      }
      onTime(next)
      id = requestAnimationFrame(step)
    }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
    // onTime / onPlaying 每次渲染都是新函数，只跟播放状态和长度走
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, len, loop])

  const drag = useRef(false)
  const scrub = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = true
      onPlaying(false)
      onTime(timeAt(e.clientX))
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (drag.current) onTime(timeAt(e.clientX))
    },
    onPointerUp: () => {
      drag.current = false
    },
  }

  const step = tickStep(len, w - PAD * 2)
  const ticks = useMemo(() => {
    const out: number[] = []
    for (let s = 0; s <= len + 1e-9; s += step) out.push(Math.round(s * 1000) / 1000)
    return out
  }, [len, step])
  const digits = step < 0.1 ? 2 : 1
  const shown = groups
    .map((g) => {
      const k = q.trim().toLowerCase()
      if (!k || g.label.toLowerCase().includes(k)) return g
      const channels = g.channels.filter((c) => c.label.toLowerCase().includes(k))
      return channels.length ? { ...g, channels } : undefined
    })
    .filter((g): g is TlGroup => !!g)
  const grid = { gridTemplateColumns: `${names.size} minmax(0, 1fr)` } as CSSProperties
  const nameDrag = useRef<{ x: number; w: number } | null>(null)
  const head = useRef<HTMLDivElement>(null)
  const frame = 1 / fps

  return (
    <section className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:bg-card">
      <header className="ue:flex ue:min-h-10 ue:flex-wrap ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-3 ue:py-1">
        <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-2 ue:text-heading ue:font-medium ue:text-fg">
          <Film className="ue:h-4 ue:w-4 ue:shrink-0 ue:text-muted" />
          {title}
        </span>
        <span className="ue:ml-auto ue:flex ue:min-w-0 ue:items-center ue:gap-1">
          {aside}
          <ui.IconButton icon={SkipBack} label={t('回到开头')} size="sm" onClick={() => onTime(0)} />
          <ui.IconButton
            icon={ChevronLeft}
            label={t('上一帧')}
            size="sm"
            onClick={() => onTime(Math.max(0, Math.round((time - frame) * fps) / fps))}
          />
          <ui.IconButton
            icon={playing ? Pause : Play}
            label={playing ? t('暂停') : t('播放')}
            size="sm"
            disabled={!groups.length}
            onClick={() => {
              if (!playing && time >= len) onTime(0)
              onPlaying(!playing)
            }}
          />
          <ui.IconButton
            icon={ChevronRight}
            label={t('下一帧')}
            size="sm"
            onClick={() => onTime(Math.min(len, Math.round((time + frame) * fps) / fps))}
          />
          <ui.IconButton
            icon={Repeat}
            label={loop ? t('循环播放：开') : t('循环播放：关')}
            size="sm"
            aria-pressed={loop}
            className={cn(loop && 'ue:bg-active ue:text-fg')}
            onClick={() => onLoop(!loop)}
          />
          <span className="ue:ml-1 ue:min-w-14 ue:rounded-(--c-row-radius) ue:border ue:border-line ue:bg-field ue:px-1.5 ue:py-0.5 ue:text-right ue:font-mono ue:text-footnote ue:text-fg">
            {fmtSec(time)}
          </span>
        </span>
      </header>
      {!groups.length ? (
        <div className="ue:p-4 ue:text-footnote ue:text-subtle">{empty ?? t('没有轨道')}</div>
      ) : (
        <div ref={head} className="ue:relative ue:min-h-0 ue:flex-1 ue:overflow-auto">
          <div className="ue:sticky ue:top-0 ue:z-10 ue:grid ue:border-b ue:border-line ue:bg-card" style={grid}>
            <label className="ue:flex ue:h-8 ue:items-center ue:gap-1.5 ue:border-r ue:border-line ue:px-2">
              <Search className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('筛选轨道')}
                aria-label={t('筛选轨道')}
                className="ue:min-w-0 ue:flex-1 ue:bg-transparent ue:text-footnote ue:text-fg ue:outline-none ue:placeholder:text-subtle"
              />
            </label>
            <div
              ref={ruler}
              {...scrub}
              className="ue:relative ue:h-8 ue:cursor-ew-resize ue:select-none ue:overflow-hidden"
              title={t('按住拖动播放头')}
            >
              {ticks.map((s) => (
                <span key={s} className="ue:absolute ue:bottom-0 ue:h-full" style={{ left: xOf(s) }}>
                  <span className="ue:absolute ue:bottom-0 ue:h-2 ue:border-l ue:border-line-strong" />
                  <span className="ue:absolute ue:top-1 ue:left-1 ue:font-mono ue:text-caption ue:whitespace-nowrap ue:text-subtle">
                    {s.toFixed(digits)}s
                  </span>
                </span>
              ))}
              <span
                className="ue:absolute ue:top-0.5 ue:-translate-x-1/2 ue:rounded-[3px] ue:bg-danger ue:px-1 ue:font-mono ue:text-caption ue:text-on-danger"
                style={{ left: xOf(time) }}
              >
                {fmtSec(time)}
              </span>
            </div>
          </div>
          <div className="ue:relative">
            {shown.map((g) => {
              const open = !!q.trim() || !closed.has(g.id)
              const all = g.channels.flatMap((c) => c.keys)
              const times = [...new Set(all.map((k) => k.time))].map((time) => ({
                time,
                value: '',
                interp: 'cubic' as const,
              }))
              const GI = g.icon
              return (
                <div key={g.id}>
                  <div className="ue:grid ue:border-b ue:border-line/60 ue:bg-hover/40" style={grid}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() =>
                        setClosed((s) => {
                          const next = new Set(s)
                          if (next.has(g.id)) next.delete(g.id)
                          else next.add(g.id)
                          return next
                        })
                      }
                      className={cn(
                        ROW,
                        'ue:flex ue:min-w-0 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:border-r ue:border-line ue:px-2 ue:text-left ue:text-footnote ue:font-medium ue:text-fg',
                      )}
                    >
                      <ChevronDown
                        className={cn(
                          'ue:h-3 ue:w-3 ue:shrink-0 ue:text-muted ue:transition-transform',
                          !open && 'ue:-rotate-90',
                        )}
                      />
                      {GI && <GI className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-muted" />}
                      <span className="ue:min-w-0 ue:truncate">{g.label}</span>
                    </button>
                    <div className={cn(ROW, 'ue:relative')} {...scrub}>
                      {times.map((k) => (
                        <span key={k.time} style={{ '--x': `${xOf(k.time)}px` } as CSSProperties}>
                          <KeyMark k={k} muted />
                        </span>
                      ))}
                    </div>
                  </div>
                  {open &&
                    g.channels.map((c) => {
                      const CI = c.icon
                      return (
                        <div key={c.id} className="ue:grid ue:border-b ue:border-line/40" style={grid}>
                          <div
                            className={cn(
                              ROW,
                              'ue:flex ue:min-w-0 ue:items-center ue:gap-1.5 ue:border-r ue:border-line ue:pr-2 ue:pl-6 ue:text-footnote ue:text-fg',
                            )}
                            title={c.label}
                          >
                            {CI && <CI className="ue:h-3.5 ue:w-3.5 ue:shrink-0 ue:text-subtle" />}
                            <span className="ue:min-w-0 ue:flex-1 ue:truncate">{c.label}</span>
                            <span className="ue:shrink-0 ue:font-mono ue:text-caption ue:text-subtle">
                              {fmtValue(valueAt(c.keys, time))}
                            </span>
                          </div>
                          <div className={cn(ROW, 'ue:relative')} {...scrub}>
                            {c.keys.slice(1).map((k, i) => (
                              <span
                                key={`seg${i}`}
                                className={cn(
                                  'ue:absolute ue:top-1/2 ue:h-[3px] ue:-translate-y-1/2',
                                  c.keys[i].interp === 'constant' ? 'ue:bg-warning/20' : 'ue:bg-warning/45',
                                )}
                                style={{
                                  left: xOf(c.keys[i].time),
                                  width: Math.max(0, xOf(k.time) - xOf(c.keys[i].time)),
                                }}
                              />
                            ))}
                            {c.keys.map((k, i) => (
                              <span key={i} style={{ '--x': `${xOf(k.time)}px` } as CSSProperties}>
                                <KeyMark
                                  k={k}
                                  on={
                                    selectedKey?.group === g.id &&
                                    selectedKey.channel === c.id &&
                                    selectedKey.index === i
                                  }
                                  onPick={() => onSelectKey({ group: g.id, channel: c.id, index: i })}
                                />
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                </div>
              )
            })}
            {/* 播放头：轨道区一道竖线，不挡点击 */}
            <span
              className="ue:pointer-events-none ue:absolute ue:inset-y-0 ue:w-px ue:bg-danger"
              style={{ left: `calc(${names.size} + ${xOf(time)}px)` }}
            />
          </div>
          {/* 轨道名一栏的宽度：整列高的细线，拖动调宽，双击恢复 */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('拖动调整宽度')}
            title={t('拖动调整宽度，双击恢复默认')}
            onPointerDown={(e) => {
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              const cell = head.current?.querySelector('label')
              nameDrag.current = { x: e.clientX, w: cell?.getBoundingClientRect().width ?? 240 }
              names.setDragging(true)
            }}
            onPointerMove={(e) => {
              const s = nameDrag.current
              if (s)
                names.set(
                  Math.max(names.min, Math.min((head.current?.clientWidth ?? 800) - 200, s.w + e.clientX - s.x)),
                )
            }}
            onPointerUp={(e) => {
              const s = nameDrag.current
              if (!s) return
              nameDrag.current = null
              names.setDragging(false)
              const n = Math.max(names.min, Math.min((head.current?.clientWidth ?? 800) - 200, s.w + e.clientX - s.x))
              names.set(n)
              names.save(n)
            }}
            onDoubleClick={names.reset}
            style={{ left: `calc(${names.size} - 3px)` }}
            className="ue:group ue:absolute ue:inset-y-0 ue:z-20 ue:w-[7px] ue:cursor-col-resize"
          >
            <span
              className={cn(
                'ue:absolute ue:inset-y-0 ue:left-[3px] ue:w-px ue:transition-colors',
                names.dragging ? 'ue:bg-accent' : 'ue:group-hover:bg-accent/60',
              )}
            />
            {names.dragging && <span className="ue:fixed ue:inset-0 ue:z-50 ue:cursor-col-resize" />}
          </div>
        </div>
      )}
    </section>
  )
}
