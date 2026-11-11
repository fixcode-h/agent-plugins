import { h, t } from '../../host.ts'
import { Card, Note, fmtTime } from '../../ui.tsx'
import { Legend, LineChart, type Mark } from './charts.tsx'
import { Compare, Rows } from './Compare.tsx'
import type { LiveBuf } from './live.ts'
import { StatsBar } from './StatsBar.tsx'
import { nameOf, type Capture, type MemSummary } from './types.ts'

/** 一份内存报告的摘要：开头的内存行、按类的对象表、包含的分段 */
export function MemReportView({ s }: { s: MemSummary }) {
  const mem = s.header.filter((l) => /memory|内存/i.test(l)).slice(0, 8)
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-4 ue:overflow-auto ue:p-5">
      {!!mem.length && (
        <Card title={t('内存')}>
          <div className="ue:flex ue:flex-col ue:gap-0.5 ue:px-4 ue:py-3 ue:font-mono ue:text-footnote ue:text-fg">
            {mem.map((l) => (
              <span key={l}>{l.trim()}</span>
            ))}
          </div>
        </Card>
      )}
      <Card title={t('按类的对象')} aside={s.objects ? t('{n} 个类', { n: s.objects.rows.length }) : undefined}>
        {s.objects ? (
          <Rows columns={s.objects.columns.slice(0, 5)} rows={s.objects.rows} />
        ) : (
          <div className="ue:p-4">
            <Note>{t('这份内存报告里没认出按类的对象表，可以让 Agent 按分段看原文。')}</Note>
          </div>
        )}
      </Card>
      <div className="ue:text-footnote ue:text-subtle">
        {t('包含的分段：')}
        {s.sections.map((x) => x.command).join('  ·  ')}
      </div>
    </div>
  )
}

/**
 * 「内存」视图（性能页设计图 4 的一期部分）：已用物理 / 虚拟内存、UObject 数的实时曲线（最近 10 分钟，每 0.5 秒一点，
 * 内存报告的时间点标在图上），右栏列出内存报告，勾两份直接出对比（查泄漏：进出同一个场景各抓一份）
 */
export function MemLive({
  buf,
  running,
  reports,
  picked,
  onPick,
  onOpen,
}: {
  buf?: LiveBuf
  running: boolean
  reports: Capture[]
  picked: string[]
  onPick: (c: Capture) => void
  onOpen: (id: string) => void
}) {
  const { cn } = h()
  const mem = buf?.mem ?? []
  const last = buf?.last?.memory
  const first = mem[0]
  const now = mem.at(-1)
  const gb = (mb?: number) => (mb === undefined ? undefined : (mb / 1024).toFixed(2))
  const growth = first && now ? now.used - first.used : undefined
  const marks: Mark[] = reports
    .map((r) => ({ at: Date.parse(r.at), name: nameOf(r) }))
    .filter((r) => first && r.at >= first.t)
    .map((r) => ({ index: mem.findIndex((m) => m.t >= r.at), name: t('内存报告') }))
    .filter((m) => m.index >= 0)
  const two = picked.filter((id) => reports.some((r) => r.id === id))
  const minutes = first && now ? Math.max(1, Math.round((now.t - first.t) / 60000)) : 0
  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <StatsBar
        items={[
          {
            key: 'used',
            label: t('物理已用'),
            value: gb(last?.usedPhysicalMB),
            unit: 'GB',
            spark: mem.map((m) => m.used),
          },
          { key: 'peak', label: t('峰值'), value: gb(last?.peakPhysicalMB), unit: 'GB' },
          {
            key: 'virt',
            label: t('虚拟已用'),
            value: gb(last?.usedVirtualMB),
            unit: 'GB',
            spark: mem.map((m) => m.virt),
          },
          { key: 'avail', label: t('可用物理'), value: gb(last?.availablePhysicalMB), unit: 'GB' },
          {
            key: 'obj',
            label: 'UObject',
            value: now ? now.objects.toLocaleString() : undefined,
            spark: mem.map((m) => m.objects),
          },
          {
            key: 'grow',
            label: minutes ? t('{m} 分钟增长', { m: minutes }) : t('增长'),
            value: growth === undefined ? undefined : `${growth >= 0 ? '+' : ''}${Math.round(growth)}`,
            unit: 'MB',
            level: growth !== undefined && growth > 100 ? 'warn' : 'none',
          },
        ]}
      />
      <div className="ue:grid ue:min-h-0 ue:flex-1 ue:gap-4 ue:overflow-auto ue:p-5 ue:xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-4">
          {!running && <Note tone="info">{t('UE 没在运行：实时曲线要连着 UE，下面的内存报告照样能看、能对比。')}</Note>}
          <Card
            title={t('已用物理内存')}
            aside={<Legend items={[{ name: t('物理'), dot: 'ue:bg-run', value: gb(now?.used) }]} />}
          >
            <div className="ue:px-3 ue:pt-2 ue:pb-3">
              <LineChart
                label={t('已用内存走势')}
                height={170}
                fmt={(v) => `${(v / 1024).toFixed(2)} GB`}
                marks={marks}
                // 虚拟内存比物理内存大得多，画在一张图上两条线都会被压平：虚拟内存只看读数条
                lines={[{ name: 'used', stroke: 'ue:stroke-run', values: mem.map((m) => m.used) }]}
              />
            </div>
          </Card>
          <Card title={t('UObject 数')}>
            <div className="ue:px-3 ue:pt-2 ue:pb-3">
              <LineChart
                label={t('UObject 数走势')}
                height={110}
                fmt={(v) => Math.round(v).toLocaleString()}
                lines={[{ name: 'obj', stroke: 'ue:stroke-accent', values: mem.map((m) => m.objects) }]}
              />
            </div>
          </Card>
          <p className="ue:text-caption ue:text-subtle">
            {t('曲线留最近 10 分钟，从打开性能页开始记；离开 UE 页后不再记。')}
          </p>
        </div>
        <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-4">
          <Card title={t('内存报告')} aside={t('勾两份对比')}>
            <ul className="ue:divide-y ue:divide-line">
              {reports.map((r) => (
                <li key={r.id} className="ue:flex ue:items-center ue:gap-2 ue:px-4 ue:py-2 ue:text-footnote">
                  <input
                    type="checkbox"
                    className="ue:cursor-pointer"
                    checked={picked.includes(r.id)}
                    onChange={() => onPick(r)}
                    aria-label={t('选来对比')}
                  />
                  <button
                    type="button"
                    onClick={() => onOpen(r.id)}
                    className={cn(
                      'ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:truncate ue:text-left ue:text-fg ue:hover:underline',
                    )}
                    title={r.file}
                  >
                    {nameOf(r)}
                  </button>
                  <span className="ue:text-subtle">{fmtTime(r.at)}</span>
                </li>
              ))}
              {!reports.length && (
                <li className="ue:px-4 ue:py-3 ue:text-footnote ue:text-subtle">
                  {t('还没有内存报告，点右上角「抓内存报告」')}
                </li>
              )}
            </ul>
          </Card>
          {two.length === 2 && <Compare a={two[0]} b={two[1]} />}
        </div>
      </div>
    </div>
  )
}
