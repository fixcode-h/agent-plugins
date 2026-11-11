import { h, t } from '../../host.ts'
import { Spark, type Level } from './charts.tsx'
import { perSecond, recentAvg, type LiveBuf } from './live.ts'

export interface StatItem {
  key: string
  label: string
  /** 已经格式化好的值；undefined 显示「—」 */
  value?: string
  unit?: string
  level?: Level
  spark?: number[]
  title?: string
}

const VALUE: Record<Level, string> = {
  ok: 'ue:text-success',
  warn: 'ue:text-warning',
  bad: 'ue:text-danger',
  none: 'ue:text-fg',
}

/** 读数条：一排数字 + 每个下面一条走势线。实时时和 stat unit 同源同配色；看文件时显示这份文件的摘要 */
export function StatsBar({ items, badge }: { items: StatItem[]; badge?: string }) {
  const { cn } = h()
  return (
    <div className="ue:flex ue:shrink-0 ue:overflow-x-auto ue:border-b ue:border-line ue:bg-panel">
      {items.map((x, i) => (
        <div
          key={x.key}
          title={x.title}
          className="ue:min-w-24 ue:flex-1 ue:border-r ue:border-line ue:px-3.5 ue:pt-2 ue:pb-1.5 ue:last:border-r-0"
        >
          <div className="ue:flex ue:items-center ue:gap-1.5 ue:text-caption ue:whitespace-nowrap ue:text-subtle">
            {x.label}
            {i === 0 && badge && (
              <span className="ue:ml-auto ue:rounded-sm ue:bg-hover ue:px-1 ue:text-[10.5px] ue:text-muted">
                {badge}
              </span>
            )}
          </div>
          <div
            className={cn(
              'ue:font-mono ue:text-[19px] ue:leading-tight ue:font-semibold ue:tabular-nums ue:transition-colors ue:duration-300',
              VALUE[x.level ?? 'none'],
            )}
          >
            {x.value ?? '—'}
            {x.value !== undefined && x.unit && (
              <small className="ue:ml-0.5 ue:text-caption ue:font-normal ue:text-subtle">{x.unit}</small>
            )}
          </div>
          <Spark values={x.spark ?? []} level={x.level} className="ue:mt-0.5 ue:block ue:h-[18px] ue:w-full" />
        </div>
      ))}
    </div>
  )
}

const ms = (v: number | undefined) => (v === undefined ? undefined : v.toFixed(1))
const big = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}` : v.toLocaleString())

/** 实时读数条的内容：Frame / Game / Draw / RHI / GPU / FPS / Mem / Draws / Prims（stat unit 的那几行） */
export function liveItems(b: LiveBuf): StatItem[] {
  const th = b.last?.thresholds ?? { target: 33.9, unacceptable: 50 }
  const lv = (v: number | undefined): Level =>
    v === undefined ? 'none' : v > th.unacceptable ? 'bad' : v > th.target ? 'warn' : 'ok'
  const one = (key: 'frame' | 'game' | 'draw' | 'rhi' | 'gpu', label: string, title: string): StatItem => {
    const v = recentAvg(b, key)
    return { key, label, value: ms(v), unit: 'ms', level: lv(v), spark: perSecond(b, key), title }
  }
  const frame = recentAvg(b, 'frame', 1)
  const draws = recentAvg(b, 'draws')
  const prims = recentAvg(b, 'prims')
  const drawStats = b.last?.drawStats && draws !== undefined && draws >= 0
  const memGB = b.last ? b.last.memory.usedPhysicalMB / 1024 : undefined
  return [
    one('frame', 'Frame', t('整帧时间')),
    one('game', 'Game', t('游戏线程')),
    one('draw', 'Draw', t('渲染线程')),
    one('rhi', 'RHI', t('RHI 线程')),
    one('gpu', 'GPU', t('GPU 时间')),
    {
      key: 'fps',
      label: 'FPS',
      value: frame ? Math.round(1000 / frame).toString() : undefined,
      level: lv(frame),
      spark: perSecond(b, 'frame').map((x) => (x > 0 ? 1000 / x : 0)),
    },
    {
      key: 'mem',
      label: 'Mem',
      value: memGB?.toFixed(2),
      unit: 'GB',
      spark: b.mem.slice(-120).map((m) => m.used),
      title: t('已用物理内存，峰值 {peak} GB', { peak: ((b.last?.memory.peakPhysicalMB ?? 0) / 1024).toFixed(2) }),
    },
    {
      key: 'draws',
      label: 'Draws',
      value: drawStats ? Math.round(draws!).toLocaleString() : undefined,
      spark: drawStats ? perSecond(b, 'draws') : [],
      title: drawStats ? undefined : t('这个引擎版本的桥接不读 Draw Calls'),
    },
    {
      key: 'prims',
      label: 'Prims',
      value: drawStats && prims !== undefined ? big(Math.round(prims)) : undefined,
      unit: drawStats && prims !== undefined && prims >= 1e6 ? 'M' : undefined,
      spark: drawStats ? perSecond(b, 'prims') : [],
    },
  ]
}
