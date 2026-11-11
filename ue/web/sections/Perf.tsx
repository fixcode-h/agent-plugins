import { Bookmark, Circle, MessageSquare, Square, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { pget, ppost, useAction, useLoad } from '../api.ts'
import { useToChat } from '../chat.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { SplitHandle, usePane } from '../split.tsx'
import { Badge, Confirm, ErrorText, LinkBtn, Note, PageHead, fmtSize, fmtTime, useTargetInfo } from '../ui.tsx'
import { Compare } from './perf/Compare.tsx'
import { CsvView } from './perf/CsvView.tsx'
import { recentAvg, useLive } from './perf/live.ts'
import { LiveView } from './perf/LiveView.tsx'
import { MemLive, MemReportView } from './perf/MemView.tsx'
import { Sessions } from './perf/Sessions.tsx'
import { StatsBar, liveItems } from './perf/StatsBar.tsx'
import { fileName, nameOf, type Capture, type CsvSummary, type MemSummary, type PerfState } from './perf/types.ts'

/**
 * 性能页（性能页设计 2026-11-11 一期）：顶上是和 stat unit 同源的实时读数条，左边会话列表（实时、内存、抓到的文件），
 * 右边按选中的会话显示实时帧条和线程曲线、内存曲线、CSV 详情、内存报告或两份对比。
 * 选中哪个会话写进地址（#…/perf/<会话>），刷新后还在。
 */
export function Perf() {
  const { project, target, sub, go } = useUe()
  const { inst } = useTargetInfo()
  const { ui, cn } = h()
  const chat = useToChat()
  const { busy, run } = useAction()
  const [seconds, setSeconds] = useState('30')
  const [mark, setMark] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [del, setDel] = useState<Capture>()
  const pane = usePane('perf', '264px', 200)
  const paneRef = useRef<HTMLElement>(null)
  const state = useLoad(() => pget<PerfState>(project.id, 'perf'), [project.id], 2000)
  const items = state.data?.items ?? []
  const active = state.data?.active[0]
  const live = useLive(project.id, target, inst?.pid)
  const buf = live.buf
  const reload = () => void state.reload()
  const sel = sub || 'live'
  const setSel = (id: string) => go('perf', id === 'live' ? '' : id)
  const cur = items.find((c) => c.id === sel)

  const start = (kind: 'csv' | 'memreport') =>
    run(kind, async () => {
      const r = await ppost<{ capture?: { id: string } }>(project.id, 'perf/start', {
        kind,
        seconds: Number(seconds),
        target,
      })
      // 内存报告马上出文件：直接打开；CSV 录制中留在「实时」看着
      if (r.capture) setSel(r.capture.id)
      else setSel('live')
      reload()
    })
  const stop = () =>
    run('stop', async () => {
      const r = await ppost<{ capture: { id: string } }>(project.id, 'perf/stop', { target })
      setSel(r.capture.id)
      reload()
    })
  const addMark = () =>
    mark.trim() &&
    run('mark', async () => {
      await ppost(project.id, 'perf/mark', { name: mark, target })
      setMark('')
      reload()
    })
  const toggle = (c: Capture) =>
    setPicked((p) => {
      if (p.includes(c.id)) return p.filter((x) => x !== c.id)
      // 只能对比同一种：换了种类就从这一份重新选
      const same = p.filter((id) => items.find((x) => x.id === id)?.kind === c.kind)
      return [...same.slice(-1), c.id]
    })
  const askAgent = (c: Capture, extra = '') =>
    chat.send(
      `请分析这份 UE ${c.kind === 'csv' ? '性能抓取（CSV Profiler）' : c.kind === 'memreport' ? '内存报告（memreport）' : '抓取'}：${nameOf(c)}（抓取 id ${c.id}）。\n先用 ue_capture action=summary 看摘要，再用 action=query 下钻，告诉我瓶颈在哪、可能的原因，以及下一步怎么验证。${extra ? `\n${extra}` : ''}\n我看到的现象：`,
    )
  const frameNow = buf ? recentAvg(buf, 'frame', 1) : undefined

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead
        title={t('性能')}
        desc={
          cur ? (
            <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
              <span className="ue:truncate ue:font-medium ue:text-fg">{nameOf(cur)}</span>
              <span className="ue:truncate" title={cur.file}>
                {fmtTime(cur.at)} · {fmtSize(cur.sizeKB * 1024)}
                {cur.label ? ` · ${fileName(cur.file)}` : ''}
              </span>
            </span>
          ) : sel === 'mem' ? (
            t('内存：实时曲线和内存报告')
          ) : (
            t('实时读数和 stat unit 同源；抓帧数据和内存报告，看摘要、对比，或者交给 Agent 分析')
          )
        }
      >
        {active ? (
          <>
            <span className="ue:flex ue:h-8 ue:items-center ue:gap-2 ue:rounded-lg ue:bg-danger/10 ue:px-3 ue:text-footnote ue:font-medium ue:text-danger">
              <span className="ue:h-2 ue:w-2 ue:animate-pulse ue:rounded-full ue:bg-danger" />
              <span className="ue:font-mono ue:tabular-nums">
                {Math.round(active.elapsed)} / {active.seconds} s
              </span>
              <span className="ue:h-1 ue:w-20 ue:overflow-hidden ue:rounded-full ue:bg-danger/15">
                <span
                  className="ue:block ue:h-full ue:bg-danger"
                  style={{ width: `${Math.min(100, (active.elapsed / active.seconds) * 100)}%` }}
                />
              </span>
            </span>
            <form
              className="ue:flex ue:items-center ue:gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                void addMark()
              }}
            >
              <ui.Input
                size="sm"
                className="ue:w-44"
                value={mark}
                placeholder={t('书签名，回车打书签')}
                onChange={(e: { target: { value: string } }) => setMark(e.target.value)}
              />
              <ui.IconButton
                icon={Bookmark}
                label={t('打书签')}
                size="sm"
                disabled={!mark.trim() || !!busy}
                onClick={() => void addMark()}
              />
            </form>
            <ui.Button size="sm" variant="secondary" disabled={!!busy} onClick={stop}>
              <Square className="ue:h-3.5 ue:w-3.5" /> {t('停止')}
            </ui.Button>
          </>
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
      {sel === 'live' && inst && buf && <StatsBar items={liveItems(buf)} badge="stat unit" />}
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:md:flex-row">
        <aside
          ref={paneRef}
          style={pane.style('calc(100% - 480px)')}
          className="ue:relative ue:flex ue:max-h-72 ue:shrink-0 ue:flex-col ue:border-b ue:border-line ue:md:max-h-none ue:md:w-(--ue-w) ue:md:max-w-(--ue-max) ue:md:border-r ue:md:border-b-0"
        >
          <Sessions
            items={items}
            totalKB={state.data?.totalKB ?? 0}
            sel={sel}
            onSel={setSel}
            picked={picked}
            onPick={toggle}
            onCompare={() => setSel('cmp')}
            onDelete={setDel}
            live={{
              running: !!inst,
              active,
              fps: frameNow ? Math.round(1000 / frameNow) : undefined,
              memGB: buf?.last ? buf.last.memory.usedPhysicalMB / 1024 : undefined,
            }}
          />
          <SplitHandle pane={pane} paneRef={paneRef} reserve={() => 480} edge />
        </aside>
        <main className="ue:flex ue:min-h-0 ue:min-w-0 ue:flex-1 ue:flex-col">
          <ErrorText>{state.error}</ErrorText>
          {sel === 'live' && <LiveView buf={buf} error={live.error} running={!!inst} active={active} />}
          {sel === 'mem' && (
            <MemLive
              buf={buf}
              running={!!inst}
              reports={items.filter((c) => c.kind === 'memreport')}
              picked={picked}
              onPick={toggle}
              onOpen={setSel}
            />
          )}
          {sel === 'cmp' &&
            (picked.length === 2 ? (
              <div className="ue:min-h-0 ue:flex-1 ue:overflow-auto ue:p-5">
                <Compare a={picked[0]} b={picked[1]} onClose={() => setSel('live')} />
              </div>
            ) : (
              <div className="ue:p-5">
                <Note tone="info">{t('在左边勾两份同类的抓取再对比。')}</Note>
              </div>
            ))}
          {cur && (
            <Detail
              key={cur.id}
              capture={cur}
              canAgent={chat.available}
              onAgent={(extra) => askAgent(cur, extra)}
              onDelete={() => setDel(cur)}
            />
          )}
          {!cur && !['live', 'mem', 'cmp'].includes(sel) && state.data && (
            <div className="ue:p-5">
              <Note tone="info">{t('这份抓取已经不在了（可能被删了），在左边选别的。')}</Note>
            </div>
          )}
        </main>
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
            if (sel === c.id) setSel('live')
            reload()
          })
        }}
      >
        <div className={cn('ue:font-mono ue:text-footnote ue:break-all')}>{del?.file}</div>
        {del?.imported && <div className="ue:mt-2 ue:text-subtle">{t('导入的外部文件只取消登记，不删原文件。')}</div>}
      </Confirm>
      {chat.dialog}
    </div>
  )
}

/** 一份抓取的详情：先读摘要，CSV 和内存报告各用自己的视图 */
function Detail({
  capture,
  canAgent,
  onAgent,
  onDelete,
}: {
  capture: Capture
  canAgent: boolean
  onAgent: (extra: string) => void
  onDelete: () => void
}) {
  const { project } = useUe()
  const { ui } = h()
  const sum = useLoad(
    () =>
      capture.kind === 'trace'
        ? Promise.resolve(undefined)
        : ppost<{ summary: CsvSummary | MemSummary }>(project.id, 'perf/summary', { id: capture.id }),
    [project.id, capture.id],
  )
  const bar = (
    <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:px-5 ue:py-2">
      <Badge tone={capture.kind === 'csv' ? 'run' : capture.kind === 'memreport' ? 'ok' : 'accent'}>
        {capture.kind === 'csv' ? t('帧数据') : capture.kind === 'memreport' ? t('内存报告') : 'trace'}
      </Badge>
      <span className="ue:min-w-0 ue:flex-1 ue:truncate ue:text-footnote ue:text-subtle" title={capture.file}>
        {capture.file}
      </span>
      {canAgent && capture.kind !== 'trace' && (
        <LinkBtn onClick={() => onAgent('')}>
          <MessageSquare className="ue:h-3.5 ue:w-3.5" /> {t('让 Agent 分析')}
        </LinkBtn>
      )}
      <ui.IconButton icon={Trash2} tone="danger" label={t('删除')} size="xs" onClick={onDelete} />
    </div>
  )
  if (capture.kind === 'trace')
    return (
      <>
        {bar}
        <div className="ue:p-5">
          <Note tone="info">
            {t('Unreal Insights 的 trace 这个版本还不能在这里分析，先用 Unreal Insights 打开看。')}
          </Note>
        </div>
      </>
    )
  return (
    <>
      {bar}
      {sum.error && (
        <div className="ue:p-5">
          <ErrorText>{sum.error}</ErrorText>
        </div>
      )}
      {!sum.data && !sum.error && <div className="ue:p-5 ue:text-footnote ue:text-subtle">{t('正在读文件…')}</div>}
      {sum.data && capture.kind === 'csv' && (
        <CsvView capture={capture} s={sum.data.summary as CsvSummary} onAgent={canAgent ? onAgent : undefined} />
      )}
      {sum.data && capture.kind === 'memreport' && <MemReportView s={sum.data.summary as MemSummary} />}
    </>
  )
}
