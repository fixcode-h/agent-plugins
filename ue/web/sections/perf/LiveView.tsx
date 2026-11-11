import { Gauge } from 'lucide-react'
import { h, t } from '../../host.ts'
import { Card, ErrorText, NotRunning } from '../../ui.tsx'
import { FrameBars, Legend, LineChart, type Mark } from './charts.tsx'
import { buckets, type LiveBuf } from './live.ts'
import type { Active } from './types.ts'

const FRAMES = 300
const THREADS = [
  { key: 'game', name: 'Game', stroke: 'ue:stroke-accent', dot: 'ue:bg-accent' },
  { key: 'draw', name: 'Draw', stroke: 'ue:stroke-run', dot: 'ue:bg-run' },
  { key: 'rhi', name: 'RHI', stroke: 'ue:stroke-peer', dot: 'ue:bg-peer' },
  { key: 'gpu', name: 'GPU', stroke: 'ue:stroke-success', dot: 'ue:bg-success' },
] as const

/** 书签（抓取开始后第几秒）换成帧条上的第几根柱 */
function marksOn(times: number[], active?: Active): Mark[] {
  if (!active || !times.length) return []
  const start = Date.parse(active.startedAt)
  return active.marks
    .map((m) => {
      const at = start + m.at * 1000
      const i = times.findIndex((x) => x >= at)
      return { index: i, name: m.name }
    })
    .filter((m) => m.index >= 0)
}

/**
 * 「实时」视图（性能页设计图 1 的一期部分）：最近 300 帧的帧条、最近 60 秒的各线程曲线、最近的慢帧和计数器。
 * 数据来自 useLive 的轮询，读数条在页面外层画
 */
export function LiveView({
  buf,
  error,
  running,
  active,
}: {
  buf?: LiveBuf
  error: string
  running: boolean
  active?: Active
}) {
  const { cn } = h()
  if (!running)
    return (
      <NotRunning
        icon={Gauge}
        what={t('实时读数要连着正在运行的 UE。已经抓到的文件在左边，照样能看、能对比、能交给 Agent。')}
      />
    )
  const th = buf?.last?.thresholds ?? { target: 33.9, unacceptable: 50 }
  const n = buf ? Math.min(buf.frame.length, FRAMES) : 0
  const frames = buf ? buf.frame.slice(-n) : []
  const times = buf ? buf.t.slice(-n) : []
  const now = Date.now()
  // 最近 60 秒里最慢的几帧，带上那一帧哪个线程最忙（Game / Draw / GPU 谁最接近整帧时间，瓶颈就在谁）
  const slow = buf
    ? buf.frame
        .map((v, i) => ({ v, i }))
        .filter((x) => x.v > th.target)
        .sort((a, b) => b.v - a.v)
        .slice(0, 8)
        .map(({ v, i }) => {
          const parts = THREADS.map((x) => ({ name: x.name, v: buf[x.key][i] })).sort((a, b) => b.v - a.v)
          return { ms: v, ago: (now - buf.t[i]) / 1000, top: parts[0] }
        })
    : []
  const last = buf?.last
  const objects = buf?.mem.at(-1)?.objects
  const gb = (mb?: number) => (mb === undefined ? '—' : `${(mb / 1024).toFixed(2)} GB`)
  const kv = (k: string, v: string, hint?: string) => (
    <div className="ue:flex ue:items-baseline ue:gap-2 ue:border-b ue:border-line ue:px-4 ue:py-2 ue:last:border-b-0">
      <span className="ue:text-footnote ue:text-subtle">{k}</span>
      {hint && <span className="ue:text-caption ue:text-subtle/80">{hint}</span>}
      <span className="ue:ml-auto ue:font-mono ue:text-footnote ue:text-fg ue:tabular-nums">{v}</span>
    </div>
  )
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-4 ue:overflow-auto ue:p-5">
      <ErrorText>{error}</ErrorText>
      <Card
        title={t('帧')}
        aside={
          <span>
            {n
              ? t('最近 {n} 帧 · 超过 {a} ms 变黄、超过 {b} ms 变红（和 stat unit 一样）', {
                  n,
                  a: th.target.toFixed(1),
                  b: th.unacceptable.toFixed(1),
                })
              : t('正在开始采样…')}
          </span>
        }
      >
        <div className="ue:px-3 ue:pt-2 ue:pb-3">
          <FrameBars
            values={frames}
            th={th}
            marks={marksOn(times, active)}
            label={t('最近每帧的帧时间')}
            height={130}
          />
        </div>
      </Card>
      <Card
        title={t('线程时间')}
        aside={
          <Legend
            items={THREADS.map((x) => ({
              name: x.name,
              dot: x.dot,
              value: buf && buf[x.key].length ? `${buf[x.key][buf[x.key].length - 1].toFixed(1)}` : undefined,
            }))}
          />
        }
      >
        <div className="ue:px-3 ue:pt-2 ue:pb-3">
          <LineChart
            label={t('最近 60 秒各线程时间')}
            height={150}
            min={0}
            fmt={(v) => `${v.toFixed(1)} ms`}
            lines={buf ? THREADS.map((x) => ({ name: x.name, stroke: x.stroke, values: buckets(buf, x.key) })) : []}
          />
          <div className="ue:mt-1 ue:flex ue:justify-between ue:font-mono ue:text-[10.5px] ue:text-subtle">
            <span>-60 s</span>
            <span>{t('现在')}</span>
          </div>
        </div>
      </Card>
      <div className="ue:grid ue:gap-4 ue:xl:grid-cols-2">
        <Card
          title={t('最近 60 秒最慢的帧')}
          aside={slow.length ? t('超过 {ms} ms 的', { ms: th.target.toFixed(1) }) : undefined}
        >
          {slow.length ? (
            <ul className="ue:divide-y ue:divide-line">
              {slow.map((s, i) => (
                <li key={i} className="ue:flex ue:items-center ue:gap-3 ue:px-4 ue:py-2 ue:text-footnote">
                  <span
                    className={cn(
                      'ue:w-20 ue:font-mono ue:tabular-nums',
                      s.ms > th.unacceptable ? 'ue:text-danger' : 'ue:text-warning',
                    )}
                  >
                    {s.ms.toFixed(1)} ms
                  </span>
                  <span className="ue:text-subtle">{t('{s} 秒前', { s: Math.round(s.ago) })}</span>
                  <span className="ue:ml-auto ue:text-subtle">
                    {t('最忙：{name} {ms} ms', { name: s.top.name, ms: s.top.v.toFixed(1) })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ue:px-4 ue:py-4 ue:text-footnote ue:text-subtle">
              {buf?.frame.length
                ? t('最近 60 秒没有超过 {ms} ms 的帧', { ms: th.target.toFixed(1) })
                : t('正在开始采样…')}
            </p>
          )}
        </Card>
        <Card title={t('计数器')}>
          {kv(
            t('已用物理内存'),
            gb(last?.memory.usedPhysicalMB),
            t('峰值 {v}', { v: gb(last?.memory.peakPhysicalMB) }),
          )}
          {kv(t('已用虚拟内存'), gb(last?.memory.usedVirtualMB))}
          {kv(
            t('可用物理内存'),
            gb(last?.memory.availablePhysicalMB),
            t('共 {v}', { v: gb(last?.memory.totalPhysicalMB) }),
          )}
          {kv('UObject', objects === undefined ? '—' : objects.toLocaleString())}
          {kv(
            'Draw Calls',
            last?.drawStats && buf?.draws.length ? Math.round(buf.draws.at(-1)!).toLocaleString() : '—',
          )}
          {kv(t('图元'), last?.drawStats && buf?.prims.length ? Math.round(buf.prims.at(-1)!).toLocaleString() : '—')}
        </Card>
      </div>
    </div>
  )
}
