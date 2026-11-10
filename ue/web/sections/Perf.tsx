import { Bookmark, Circle, GitCompareArrows, MessageSquare, Square, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { pget, ppost, useAction, useLoad } from '../api.ts'
import { useToChat } from '../chat.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { Badge, Card, Confirm, ErrorText, LinkBtn, Note, PageHead, fmtSize, fmtTime, useTargetInfo } from '../ui.tsx'

interface Capture {
  id: string
  kind: 'csv' | 'memreport' | 'trace'
  label?: string
  file: string
  sizeKB: number
  at: string
  by?: string
  imported?: boolean
}
interface Active {
  id: string
  label: string
  seconds: number
  elapsed: number
  marks: { at: number; name: string }[]
}
interface PerfState {
  items: Capture[]
  totalKB: number
  active: Active[]
}
interface Stat {
  avg: number
  p95: number
  p99: number
  max: number
}
interface CsvSummary {
  frames: number
  seconds: number
  fps?: { avg: number; p95Low: number; p99Low: number }
  key: Record<string, Stat>
  hitches: { thresholdMs: number; count: number; worst: { frame: number; at: number; ms: number }[] }
  events: { at: number; name: string }[]
  note?: string
}
interface MemSummary {
  header: string[]
  sections: { command: string; lines: number }[]
  objects?: { columns: string[]; rows: (string | number)[][] }
}
interface Series {
  series: { at: number; avg: number; max: number }[]
}

const KIND: Record<Capture['kind'], () => string> = {
  csv: () => t('帧数据'),
  memreport: () => t('内存报告'),
  trace: () => 'Insights',
}
const fileName = (f: string) => f.split(/[\\/]/).pop() ?? f
const nameOf = (c: Capture) => c.label || fileName(c.file)

/**
 * 性能（设计稿「性能与内存分析」第一期）：在这里发起 CSV Profiler 抓取和内存报告，看抓到的文件的摘要，
 * 选两份同类的对比，或者把一份抓取交给对话里的 Agent 分析。分析都在面板这边做，UE 关了也能看。
 */
export function Perf() {
  const { project, target } = useUe()
  const { inst } = useTargetInfo()
  const { ui, cn } = h()
  const chat = useToChat()
  const { busy, run } = useAction()
  const [seconds, setSeconds] = useState('30')
  const [mark, setMark] = useState('')
  const [open, setOpen] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [diff, setDiff] = useState<[string, string]>()
  const [del, setDel] = useState<Capture>()
  const state = useLoad(() => pget<PerfState>(project.id, 'perf'), [project.id], 2000)
  const items = state.data?.items ?? []
  const active = state.data?.active[0]
  const reload = () => void state.reload()

  const start = (kind: 'csv' | 'memreport') =>
    run(kind, async () => {
      const r = await ppost<{ capture?: { id: string } }>(project.id, 'perf/start', { kind, seconds: Number(seconds), target })
      if (r.capture) setOpen(r.capture.id)
      reload()
    })
  const stop = () =>
    run('stop', async () => {
      const r = await ppost<{ capture: { id: string } }>(project.id, 'perf/stop', { target })
      setOpen(r.capture.id)
      reload()
    })
  const toggle = (c: Capture) =>
    setPicked((p) => {
      if (p.includes(c.id)) return p.filter((x) => x !== c.id)
      // 只能对比同一种：换了种类就从这一份重新选
      const same = p.filter((id) => items.find((x) => x.id === id)?.kind === c.kind)
      return [...same.slice(-1), c.id]
    })
  const askAgent = (c: Capture) =>
    chat.send(
      `请分析这份 UE ${c.kind === 'csv' ? '性能抓取（CSV Profiler）' : c.kind === 'memreport' ? '内存报告（memreport）' : '抓取'}：${nameOf(c)}（抓取 id ${c.id}）。\n先用 ue_capture action=summary 看摘要，再用 action=query 下钻，告诉我瓶颈在哪、可能的原因，以及下一步怎么验证。\n我看到的现象：`,
    )

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('性能')} desc={t('抓帧数据和内存报告，看摘要、对比，或者交给 Agent 分析')}>
        {active ? (
          <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={stop}>
            <Square className="ue:h-3.5 ue:w-3.5" /> {t('停止抓取')}
          </ui.Button>
        ) : (
          <>
            <ui.Select
              size="sm"
              className="ue:w-32"
              value={seconds}
              onChange={(e: { target: { value: string } }) => setSeconds(e.target.value)}
              options={['10', '30', '60', '120', '300'].map((v) => ({ value: v, label: t('最长 {n} 秒', { n: v }) }))}
            />
            <ui.Button size="sm" disabled={!inst || !!busy} onClick={() => start('csv')}>
              <Circle className="ue:h-3.5 ue:w-3.5" /> {t('抓帧数据')}
            </ui.Button>
            <ui.Button size="sm" variant="secondary" disabled={!inst || !!busy} onClick={() => start('memreport')}>
              {busy === 'memreport' ? t('正在抓…') : t('抓内存报告')}
            </ui.Button>
          </>
        )}
      </PageHead>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-4 ue:overflow-auto ue:p-6">
        <ErrorText>{state.error}</ErrorText>
        {!inst && !active && (
          <Note tone="info">{t('UE 没在运行：现在不能抓新的，已经抓到的文件照样能看、能对比、能交给 Agent。')}</Note>
        )}
        {active && (
          <Card title={t('正在抓帧数据')} aside={t('{s} / {max} 秒，到时间自动停', { s: Math.round(active.elapsed), max: active.seconds })}>
            <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2 ue:px-4 ue:py-3">
              <ui.Input
                size="sm"
                className="ue:w-56"
                value={mark}
                placeholder={t('书签名，例如 打开背包')}
                onChange={(e: { target: { value: string } }) => setMark(e.target.value)}
              />
              <ui.Button
                size="sm"
                variant="secondary"
                disabled={!mark.trim() || !!busy}
                onClick={() =>
                  run('mark', async () => {
                    await ppost(project.id, 'perf/mark', { name: mark, target })
                    setMark('')
                    reload()
                  })
                }
              >
                <Bookmark className="ue:h-3.5 ue:w-3.5" /> {t('打书签')}
              </ui.Button>
              <span className="ue:text-footnote ue:text-subtle">
                {active.marks.length
                  ? active.marks.map((m) => `${m.name} @${m.at}s`).join('  ·  ')
                  : t('在要测的操作前后各打一个书签，分析时可以按书签分段')}
              </span>
            </div>
          </Card>
        )}
        <Card
          title={t('抓到的文件')}
          aside={
            <span className="ue:flex ue:items-center ue:gap-2">
              {picked.length === 2 && (
                <LinkBtn onClick={() => setDiff([picked[0], picked[1]])}>
                  <GitCompareArrows className="ue:h-3.5 ue:w-3.5" /> {t('对比选中的两份')}
                </LinkBtn>
              )}
              {items.length ? t('{n} 份，共 {size}', { n: items.length, size: fmtSize((state.data?.totalKB ?? 0) * 1024) }) : undefined}
            </span>
          }
        >
          <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line">
            {items.map((c) => (
              <li key={c.id} className="ue:group ue:flex ue:flex-col">
                <div className={cn('ue:flex ue:items-center ue:gap-3 ue:px-4 ue:py-2.5', open === c.id && 'ue:bg-hover')}>
                  <input
                    type="checkbox"
                    aria-label={t('选来对比')}
                    className="ue:cursor-pointer"
                    disabled={c.kind === 'trace'}
                    checked={picked.includes(c.id)}
                    onChange={() => toggle(c)}
                  />
                  <button
                    type="button"
                    className="ue:flex ue:min-w-0 ue:flex-1 ue:cursor-pointer ue:items-center ue:gap-3 ue:text-left"
                    onClick={() => setOpen(open === c.id ? '' : c.id)}
                  >
                    <Badge tone={c.kind === 'csv' ? 'accent' : c.kind === 'memreport' ? 'run' : 'muted'}>{KIND[c.kind]()}</Badge>
                    <span className="ue:min-w-0 ue:flex-1">
                      <span className="ue:block ue:truncate ue:text-body ue:text-fg">{nameOf(c)}</span>
                      <span className="ue:block ue:truncate ue:text-caption ue:text-subtle" title={c.file}>
                        {c.label ? `${fileName(c.file)} · ` : ''}
                        {fmtTime(c.at)} · {fmtSize(c.sizeKB * 1024)}
                        {c.by ? ` · ${c.by === 'user' ? t('你') : c.by}` : ''}
                        {c.imported ? ` · ${t('导入的')}` : ''}
                      </span>
                    </span>
                  </button>
                  {chat.available && c.kind !== 'trace' && (
                    <LinkBtn onClick={() => askAgent(c)}>
                      <MessageSquare className="ue:h-3.5 ue:w-3.5" /> {t('让 Agent 分析')}
                    </LinkBtn>
                  )}
                  <ui.IconButton icon={Trash2} tone="danger" reveal="hover" label={t('删除')} size="xs" onClick={() => setDel(c)} />
                </div>
                {open === c.id && <Detail capture={c} />}
              </li>
            ))}
            {!items.length && (
              <li className="ue:p-6 ue:text-center ue:text-footnote ue:text-subtle">
                {t('还没有抓取。点右上角「抓帧数据」录一段，或者让 Agent 用 ue_perf 抓')}
              </li>
            )}
          </ul>
        </Card>
        {diff && <Compare a={diff[0]} b={diff[1]} onClose={() => setDiff(undefined)} />}
      </div>
      <Confirm
        open={!!del}
        title={del?.imported ? t('取消登记这份抓取？') : t('删除这份抓取文件？')}
        okText={del?.imported ? t('取消登记') : t('删除')}
        danger
        onCancel={() => setDel(undefined)}
        onOk={() => {
          const c = del!
          setDel(undefined)
          void run('del', async () => {
            await ppost(project.id, 'perf/delete', { id: c.id })
            setPicked((p) => p.filter((x) => x !== c.id))
            reload()
          })
        }}
      >
        <div className="ue:font-mono ue:text-footnote ue:break-all">{del?.file}</div>
        {del?.imported && <div className="ue:mt-2 ue:text-subtle">{t('导入的外部文件只取消登记，不删原文件。')}</div>}
      </Confirm>
      {chat.dialog}
    </div>
  )
}

const TH = 'ue:px-3 ue:py-1.5 ue:text-left ue:text-caption ue:font-medium ue:text-subtle'
const TD = 'ue:px-3 ue:py-1.5 ue:font-mono ue:text-footnote ue:text-fg'
const NUM = `${TD} ue:text-right ue:tabular-nums`

function Detail({ capture }: { capture: Capture }) {
  const { project } = useUe()
  const sum = useLoad(
    () =>
      capture.kind === 'trace'
        ? Promise.resolve(undefined)
        : ppost<{ summary: CsvSummary | MemSummary }>(project.id, 'perf/summary', { id: capture.id }),
    [project.id, capture.id],
  )
  if (capture.kind === 'trace')
    return (
      <div className="ue:px-4 ue:pb-3">
        <Note tone="info">{t('Unreal Insights 的 trace 这个版本还不能在这里分析，先用 Unreal Insights 打开看。')}</Note>
      </div>
    )
  return (
    <div className="ue:flex ue:flex-col ue:gap-3 ue:border-t ue:border-line ue:bg-panel ue:px-4 ue:py-3">
      <ErrorText>{sum.error}</ErrorText>
      {!sum.data && !sum.error && <div className="ue:text-footnote ue:text-subtle">{t('正在读文件…')}</div>}
      {sum.data && capture.kind === 'csv' && <CsvView id={capture.id} s={sum.data.summary as CsvSummary} />}
      {sum.data && capture.kind === 'memreport' && <MemView s={sum.data.summary as MemSummary} />}
    </div>
  )
}

function CsvView({ id, s }: { id: string; s: CsvSummary }) {
  const { project } = useUe()
  const ft = useLoad(
    () => ppost<Series>(project.id, 'perf/query', { id, what: 'column', name: 'FrameTime', top: 200 }).catch(() => undefined),
    [project.id, id],
  )
  return (
    <>
      <div className="ue:flex ue:flex-wrap ue:gap-x-6 ue:gap-y-1 ue:text-footnote ue:text-subtle">
        <span>{t('{n} 帧，{s} 秒', { n: s.frames, s: s.seconds })}</span>
        {s.fps && <span>{t('平均 {fps} 帧/秒，最差 1% 时 {low} 帧/秒', { fps: s.fps.avg, low: s.fps.p99Low })}</span>}
        <span className={s.hitches.count ? 'ue:text-danger' : undefined}>
          {t('卡顿 {n} 帧（超过 {ms} 毫秒）', { n: s.hitches.count, ms: s.hitches.thresholdMs })}
        </span>
      </div>
      {s.note && <Note>{s.note}</Note>}
      {ft.data && <FrameChart series={ft.data.series} threshold={s.hitches.thresholdMs} />}
      <table className="ue:w-full ue:border-collapse">
        <thead>
          <tr className="ue:border-b ue:border-line">
            <th className={TH}>{t('指标')}</th>
            <th className={`${TH} ue:text-right`}>{t('平均')}</th>
            <th className={`${TH} ue:text-right`}>P95</th>
            <th className={`${TH} ue:text-right`}>P99</th>
            <th className={`${TH} ue:text-right`}>{t('最大')}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(s.key).map(([name, v]) => (
            <tr key={name} className="ue:border-b ue:border-line/60">
              <td className={TD}>{name}</td>
              <td className={NUM}>{v.avg}</td>
              <td className={NUM}>{v.p95}</td>
              <td className={NUM}>{v.p99}</td>
              <td className={NUM}>{v.max}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!!s.hitches.worst.length && (
        <div className="ue:text-footnote ue:text-subtle">
          {t('最慢的几帧：')}
          {s.hitches.worst.map((w) => t('第 {f} 帧 {ms} 毫秒（{at} 秒处）', { f: w.frame, ms: w.ms, at: w.at })).join('，')}
        </div>
      )}
      {!!s.events.length && (
        <div className="ue:text-footnote ue:text-subtle">
          {t('书签：')}
          {s.events.map((e) => `${e.name} @${e.at}s`).join('  ·  ')}
        </div>
      )}
    </>
  )
}

/** 帧时间图：每一段画这段里最慢的一帧，超过卡顿门槛的标红；纵轴封顶在门槛的 3 倍，免得一次长卡顿把其余的压成一条线 */
function FrameChart({ series, threshold }: { series: Series['series']; threshold: number }) {
  if (series.length < 2) return null
  const w = 800
  const hgt = 72
  const top = Math.max(threshold * 3, 1)
  const bw = w / series.length
  const y = (v: number) => hgt - (Math.min(v, top) / top) * hgt
  return (
    <svg
      viewBox={`0 0 ${w} ${hgt}`}
      preserveAspectRatio="none"
      className="ue:h-[72px] ue:w-full ue:rounded-md ue:border ue:border-line ue:bg-card"
      role="img"
      aria-label={t('帧时间走势')}
    >
      {series.map((p, i) => (
        <rect
          key={i}
          x={i * bw}
          y={y(p.max)}
          width={Math.max(bw - 0.5, 0.5)}
          height={hgt - y(p.max)}
          className={p.max > threshold ? 'ue:fill-danger' : 'ue:fill-accent/60'}
        >
          <title>{`${p.at}s · ${p.max} ms`}</title>
        </rect>
      ))}
      <line x1="0" x2={w} y1={y(threshold)} y2={y(threshold)} className="ue:stroke-subtle/50" strokeDasharray="4 4" strokeWidth="1" />
    </svg>
  )
}

function MemView({ s }: { s: MemSummary }) {
  const mem = s.header.filter((l) => /memory|内存/i.test(l)).slice(0, 6)
  return (
    <>
      {!!mem.length && (
        <div className="ue:flex ue:flex-col ue:gap-0.5 ue:font-mono ue:text-footnote ue:text-fg">
          {mem.map((l) => (
            <span key={l}>{l.trim()}</span>
          ))}
        </div>
      )}
      {s.objects ? (
        <Rows columns={s.objects.columns.slice(0, 5)} rows={s.objects.rows} />
      ) : (
        <Note>{t('这份内存报告里没认出按类的对象表，可以让 Agent 按分段看原文。')}</Note>
      )}
      <div className="ue:text-footnote ue:text-subtle">
        {t('包含的分段：')}
        {s.sections.map((x) => x.command).join('  ·  ')}
      </div>
    </>
  )
}

function Rows({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <table className="ue:w-full ue:border-collapse">
      <thead>
        <tr className="ue:border-b ue:border-line">
          {columns.map((c, i) => (
            <th key={c} className={i ? `${TH} ue:text-right` : TH}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r[0])} className="ue:border-b ue:border-line/60">
            {columns.map((c, i) => (
              <td key={c} className={i ? NUM : TD}>
                {r[i]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface CsvDiff {
  hitches: { a: number; b: number; thresholdMs: number }
  key: { column: string; a: number; b: number; delta: number; pct: number | null }[]
  changed: { column: string; a: number; b: number; delta: number; pct: number | null }[]
}
interface MemDiff {
  totals: { countDelta: number; kbDelta: number; resKbDelta: number }
  byCount: { class: string; countA: number; countB: number; countDelta: number; kbDelta: number; resKbDelta: number }[]
}

function Compare({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const { project } = useUe()
  const r = useLoad(
    () =>
      ppost<{ a: Capture; b: Capture; diff: CsvDiff | MemDiff }>(project.id, 'perf/compare', {
        // 先抓的当 A：列表里新的在前，选的顺序不一定是时间顺序，交给服务端返回后按时间摆
        id: a,
        other: b,
      }).then(async (x) => (x.a.at <= x.b.at ? x : ppost<typeof x>(project.id, 'perf/compare', { id: b, other: a }))),
    [project.id, a, b],
  )
  const d = r.data
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n))
  return (
    <Card
      title={d ? t('对比：{a} → {b}', { a: nameOf(d.a), b: nameOf(d.b) }) : t('对比')}
      aside={<LinkBtn onClick={onClose}>{t('关闭')}</LinkBtn>}
    >
      <div className="ue:flex ue:flex-col ue:gap-3 ue:px-4 ue:py-3">
        <ErrorText>{r.error}</ErrorText>
        {d && 'hitches' in d.diff && (
          <>
            <div className="ue:text-footnote ue:text-subtle">
              {t('卡顿帧：{a} → {b}（门槛 {ms} 毫秒）', { a: d.diff.hitches.a, b: d.diff.hitches.b, ms: d.diff.hitches.thresholdMs })}
            </div>
            <Rows
              columns={[t('指标'), t('之前'), t('之后'), t('变化'), '%']}
              rows={[...d.diff.key, ...d.diff.changed.slice(0, 15)].map((x) => [x.column, x.a, x.b, sign(x.delta), x.pct === null ? '' : sign(x.pct)])}
            />
          </>
        )}
        {d && 'byCount' in d.diff && (
          <>
            <div className="ue:text-footnote ue:text-subtle">
              {t('对象总数 {n}，对象大小 {kb} KB，持有的资源 {res} KB', {
                n: sign(d.diff.totals.countDelta),
                kb: sign(d.diff.totals.kbDelta),
                res: sign(d.diff.totals.resKbDelta),
              })}
            </div>
            {d.diff.byCount.length ? (
              <Rows
                columns={[t('类'), t('之前'), t('之后'), t('数量变化'), t('大小变化 KB')]}
                rows={d.diff.byCount.map((x) => [x.class, x.countA, x.countB, sign(x.countDelta), sign(x.kbDelta)])}
              />
            ) : (
              <div className="ue:text-footnote ue:text-subtle">{t('两份报告里各个类的对象数量一样。')}</div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
