// 截帧弹窗的右栏（用户 2026-11-07 要的重新设计：操作都收进右栏，左边留给画面）：
// 截帧范围（整段 + 记下来的几段命名范围，点一段选中，自动截帧只在选中的那段里截）、自动截帧（方式、张数、去掉相似帧、清除）、画面增强。
import { Plus, ScanSearch, Trash2, WandSparkles, Loader2, Layers, Scissors, Sparkles } from 'lucide-react'
import { AUTO_MAX, RANGE_MIN, timeText, type AutoMode } from '@shared/video'
import { RANGES_MAX, rangeLabel, type NamedRange } from '@shared/video-tools'
import { t } from '@shared/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/input'

const COUNTS = [4, 6, 8, 10, 12, 16, 24].filter((n) => n <= AUTO_MAX)

/** 新范围的 id：只在这个视频里唯一就够 */
const newId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** 从当前位置起的一段新范围：默认取整段的 1/5（至少 RANGE_MIN），放不下时往前挪 */
export function rangeFrom(at: number, duration: number, name = ''): NamedRange {
  const len = Math.min(duration, Math.max(RANGE_MIN, duration / 5))
  const start = Math.max(0, Math.min(at, duration - len))
  return { id: newId(), name, start, end: Math.min(duration, start + len) }
}

function Section({
  icon: Icon,
  title,
  extra,
  children,
}: {
  icon: typeof Plus
  title: string
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="vd:flex vd:flex-col vd:gap-2.5 vd:border-b vd:border-line vd:px-4 vd:py-3.5 vd:last:border-b-0">
      <h3 className="vd:flex vd:h-5 vd:items-center vd:gap-1.5 vd:text-footnote vd:font-medium vd:tracking-wide vd:text-muted">
        <Icon className="vd:h-3.5 vd:w-3.5" />
        {title}
        <span className="vd:flex-1" />
        {extra}
      </h3>
      {children}
    </section>
  )
}

export function SidePanel(p: {
  duration: number
  cur: number
  busy: boolean
  ranges: NamedRange[]
  /** 选中的范围 id；空是整段 */
  active: string
  onActive: (id: string) => void
  onRanges: (list: NamedRange[]) => void
  mode: AutoMode
  count: number
  onMode: (m: AutoMode) => void
  onCount: (n: number) => void
  autoRunning: boolean
  onAuto: () => void
  onDedupe: () => void
  manualCount: number
  autoCount: number
  onClear: (which: 'manual' | 'auto') => void
  /** 画面增强（EnhanceBar） */
  enhance: React.ReactNode
}) {
  const active = p.ranges.find((r) => r.id === p.active)
  const add = () => {
    const r = rangeFrom(p.cur, p.duration)
    p.onRanges([...p.ranges, r])
    p.onActive(r.id)
  }
  const item = (on: boolean) =>
    cn(
      'vd:group vd:flex vd:min-h-9 vd:cursor-pointer vd:items-center vd:gap-2 vd:rounded-lg vd:px-2.5 vd:py-1.5 vd:text-body vd:transition-colors',
      on
        ? 'vd:bg-accent-soft vd:text-fg vd:ring-1 vd:ring-accent/50'
        : 'vd:text-muted vd:hover:bg-hover vd:hover:text-fg',
    )
  const dot = (on: boolean) => (
    <span
      className={cn(
        'vd:h-3.5 vd:w-3.5 vd:shrink-0 vd:rounded-full vd:border-2',
        on ? 'vd:border-accent vd:bg-accent' : 'vd:border-line-strong',
      )}
      style={on ? { boxShadow: 'inset 0 0 0 2px var(--color-panel)' } : undefined}
      aria-hidden
    />
  )
  return (
    <aside
      className="vd:flex vd:w-[300px] vd:shrink-0 vd:flex-col vd:overflow-y-auto vd:border-l vd:border-line vd:bg-panel"
      data-surface=""
    >
      <Section
        icon={Scissors}
        title={t('截帧范围')}
        extra={
          <button
            type="button"
            onClick={add}
            disabled={p.busy || p.ranges.length >= RANGES_MAX || !(p.duration > RANGE_MIN)}
            title={t('从当前位置新建一段范围（也可以在进度条上按 I / O 设起点终点）')}
            className="vd:inline-flex vd:cursor-pointer vd:items-center vd:gap-0.5 vd:rounded vd:px-1 vd:text-footnote vd:font-normal vd:text-accent-text vd:hover:underline vd:disabled:cursor-not-allowed vd:disabled:opacity-40"
          >
            <Plus className="vd:h-3.5 vd:w-3.5" />
            {t('新范围')}
          </button>
        }
      >
        <div className="vd:flex vd:flex-col vd:gap-1" role="radiogroup" aria-label={t('截帧范围')}>
          <div
            role="radio"
            tabIndex={0}
            aria-checked={!active}
            className={item(!active)}
            onClick={() => p.onActive('')}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), p.onActive(''))}
          >
            {dot(!active)}
            <span className="vd:flex-1 vd:truncate">{t('整段视频')}</span>
            <span className="vd:font-mono vd:text-micro vd:text-subtle vd:tabular-nums">{timeText(p.duration, 0)}</span>
          </div>
          {p.ranges.map((r, i) => {
            const on = r.id === p.active
            return (
              <div
                key={r.id}
                role="radio"
                tabIndex={0}
                aria-checked={on}
                className={item(on)}
                onClick={() => p.onActive(r.id)}
                onKeyDown={(e) =>
                  e.target === e.currentTarget &&
                  (e.key === 'Enter' || e.key === ' ') &&
                  (e.preventDefault(), p.onActive(r.id))
                }
              >
                {dot(on)}
                <div className="vd:flex vd:min-w-0 vd:flex-1 vd:flex-col">
                  <input
                    value={r.name}
                    maxLength={40}
                    placeholder={rangeLabel(r, i, (n) => t('范围 {n}', { n }))}
                    aria-label={t('范围名称')}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => p.onActive(r.id)}
                    onChange={(e) =>
                      p.onRanges(p.ranges.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))
                    }
                    className="vd:h-5 vd:min-w-0 vd:rounded vd:bg-transparent vd:text-body vd:text-fg vd:outline-none vd:placeholder:text-fg vd:focus:bg-field vd:focus:px-1 vd:focus:placeholder:text-subtle"
                  />
                  <span className="vd:font-mono vd:text-micro vd:text-subtle vd:tabular-nums">
                    {timeText(r.start)} – {timeText(r.end)} · {timeText(r.end - r.start)}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={t('删除这段范围')}
                  title={t('删除这段范围')}
                  disabled={p.busy}
                  onClick={(e) => {
                    e.stopPropagation()
                    p.onRanges(p.ranges.filter((x) => x.id !== r.id))
                    if (on) p.onActive('')
                  }}
                  className="vd:grid vd:h-6 vd:w-6 vd:shrink-0 vd:cursor-pointer vd:place-items-center vd:rounded-md vd:text-subtle vd:opacity-0 vd:group-hover:opacity-100 vd:hover:bg-hover vd:hover:text-fg vd:focus-visible:opacity-100"
                >
                  <Trash2 className="vd:h-3.5 vd:w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
        <p className="vd:text-footnote vd:leading-relaxed vd:text-subtle">
          {active
            ? t('自动截帧只在这段里截，范围外截过的自动帧留着。拖进度条上的两个把手可以调整。')
            : t('在画面下方的进度条上按 I / O（或点「起点」「终点」）圈出一段，会记成一段命名范围，下次打开还在。')}
        </p>
      </Section>

      <Section icon={WandSparkles} title={t('自动截帧')}>
        <Segmented
          size="sm"
          fill
          label={t('自动截帧方式')}
          value={p.mode}
          onChange={p.onMode}
          options={[
            { id: 'scene', label: t('画面变化') },
            { id: 'screen', label: t('录屏') },
            { id: 'uniform', label: t('均匀') },
          ]}
        />
        <p className="vd:text-footnote vd:leading-relaxed vd:text-subtle">
          {p.mode === 'scene'
            ? t('在镜头切换、画面明显变了的地方截，适合剪辑过的视频和游戏实机。')
            : p.mode === 'screen'
              ? t('跳过一动不动的画面，在操作发生的地方截，适合软件录屏。')
              : t('按时长平均截。')}{' '}
          {t('每个时间点在前后 0.25 秒里挑最清楚的一张。')}
        </p>
        <div className="vd:flex vd:items-center vd:gap-1.5">
          <Select
            size="sm"
            aria-label={t('自动截几帧')}
            value={String(p.count)}
            onChange={(e) => p.onCount(Number(e.target.value))}
            className="vd:w-[92px] vd:shrink-0"
            options={COUNTS.map((n) => ({ value: String(n), label: t('{n} 帧', { n }) }))}
          />
          <Button variant="primary" size="sm" className="vd:flex-1" disabled={p.busy} onClick={p.onAuto}>
            {p.autoRunning ? (
              <Loader2 className="vd:h-3.5 vd:w-3.5 vd:animate-spin" />
            ) : (
              <ScanSearch className="vd:h-3.5 vd:w-3.5" />
            )}
            {active
              ? t('在「{name}」里截', {
                  name: rangeLabel(active, p.ranges.indexOf(active), (n) => t('范围 {n}', { n })),
                })
              : t('自动截帧')}
          </Button>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={p.busy || p.manualCount + p.autoCount < 2}
          onClick={p.onDedupe}
          title={t('几乎一样的自动帧只留最清楚的一张，手动截的不删')}
        >
          <Layers className="vd:h-3.5 vd:w-3.5" />
          {t('去掉相似帧')}
        </Button>
        <div className="vd:-mx-1 vd:flex vd:items-center vd:justify-between">
          <Button variant="ghost" size="sm" disabled={p.busy || !p.autoCount} onClick={() => p.onClear('auto')}>
            <Trash2 className="vd:h-3.5 vd:w-3.5" />
            {t('清除自动（{n}）', { n: p.autoCount })}
          </Button>
          <Button variant="ghost" size="sm" disabled={p.busy || !p.manualCount} onClick={() => p.onClear('manual')}>
            {t('清除手动（{n}）', { n: p.manualCount })}
          </Button>
        </div>
      </Section>

      <Section icon={Sparkles} title={t('画面增强')}>
        {p.enhance}
      </Section>
    </aside>
  )
}
