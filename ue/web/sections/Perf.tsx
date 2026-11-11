import { useRef, useState, type MouseEvent } from 'react'
import { pget, ppost, useAction, useLoad } from '../api.ts'
import { useToChat } from '../chat.tsx'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { SplitHandle, usePane } from '../split.tsx'
import { Confirm, ErrorText, Note, PageHead, fmtSize, fmtTime, useTargetInfo } from '../ui.tsx'
import { captureItems, RenameDialog } from './perf/CaptureMenu.tsx'
import { Compare } from './perf/Compare.tsx'
import { Detail } from './perf/Detail.tsx'
import { recentAvg, useLive } from './perf/live.ts'
import { LiveView } from './perf/LiveView.tsx'
import { MemLive } from './perf/MemView.tsx'
import { MenuHost, openMenu } from './perf/menu.tsx'
import { RecordControls, type StartOpts } from './perf/RecordControls.tsx'
import { Sessions } from './perf/Sessions.tsx'
import { StatsBar, liveItems } from './perf/StatsBar.tsx'
import { fileName, nameOf, type Capture, type PerfState } from './perf/types.ts'

/**
 * 性能页（性能页设计 2026-11-11）：顶上是和 stat unit 同源的实时读数条，左边会话列表（实时、内存、抓到的文件），
 * 右边按选中的会话显示实时帧条和线程曲线、内存曲线、trace 时间轴和调用堆栈、CSV 详情、内存报告或两份对比。
 * 各块都是 perf/ 下的独立组件，这里只管状态和摆放；切换视图时内容从下方淡入。
 * 选中哪个会话写进地址（#…/perf/<会话>），刷新后还在。
 */
export function Perf() {
  const { project, target, sub, go } = useUe()
  const { inst } = useTargetInfo()
  const { ui, cn } = h()
  const chat = useToChat()
  const { busy, run } = useAction()
  const [picked, setPicked] = useState<string[]>([])
  const [del, setDel] = useState<Capture>()
  const [ren, setRen] = useState<Capture>()
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

  const start = (o: StartOpts | { kind: 'memreport' }) =>
    run(o.kind, async () => {
      const r = await ppost<{ capture?: { id: string } }>(project.id, 'perf/start', { ...o, target })
      // 内存报告马上出文件：直接打开；trace / CSV 录制中留在「实时」看着
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
  const addMark = (name: string) =>
    run('mark', async () => {
      await ppost(project.id, 'perf/mark', { name, target })
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
      `请分析这份 UE ${c.kind === 'csv' ? '性能抓取（CSV Profiler）' : c.kind === 'memreport' ? '内存报告（memreport）' : 'trace（Unreal Insights 同款）'}：${nameOf(c)}（抓取 id ${c.id}）。\n先用 ue_capture action=summary 看摘要，再用 action=query 下钻${c.kind === 'trace' ? '（timers → butterfly → stack，定位到具体函数）' : ''}，告诉我瓶颈在哪、可能的原因，以及下一步怎么验证。${extra ? `\n${extra}` : ''}\n我看到的现象：`,
    )
  const frameNow = buf ? recentAvg(buf, 'frame', 1) : undefined
  /** 一份抓取的右键菜单（列表行、页头标题、详情文件条共用） */
  const menuFor = (e: MouseEvent, c: Capture) =>
    openMenu(
      e,
      captureItems(project.id, c, {
        onOpen: sel === c.id ? undefined : () => setSel(c.id),
        onAgent: chat.available ? () => askAgent(c) : undefined,
        onRename: () => setRen(c),
        onDelete: () => setDel(c),
        onPick: () => toggle(c),
        picked: picked.includes(c.id),
      }),
    )

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead
        title={t('性能')}
        desc={
          cur ? (
            <span
              className="ue:flex ue:min-w-0 ue:items-center ue:gap-2"
              onContextMenu={(e) => menuFor(e, cur)}
            >
              <span className="ue:truncate ue:font-medium ue:text-fg">{nameOf(cur)}</span>
              <span className="ue:truncate" title={cur.file}>
                {fmtTime(cur.at)} · {fmtSize(cur.sizeKB * 1024)}
                {cur.label ? ` · ${fileName(cur.file)}` : ''}
              </span>
            </span>
          ) : sel === 'mem' ? (
            t('内存：实时曲线和内存报告')
          ) : (
            t('实时读数和 stat unit 同源；录 trace 看时间轴和函数调用堆栈，抓帧数据和内存报告，或者交给 Agent 分析')
          )
        }
      >
        <RecordControls
          active={active}
          running={!!inst}
          busy={busy}
          onStart={start}
          onStop={stop}
          onMark={addMark}
          onMemreport={() => start({ kind: 'memreport' })}
        />
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
            onMenu={menuFor}
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
          <div key={sel} className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:motion-safe:animate-rise">
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
                onMenu={(e) => menuFor(e, cur)}
              />
            )}
            {!cur && !['live', 'mem', 'cmp'].includes(sel) && state.data && (
              <div className="ue:p-5">
                <Note tone="info">{t('这份抓取已经不在了（可能被删了），在左边选别的。')}</Note>
              </div>
            )}
          </div>
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
      <RenameDialog project={project.id} capture={ren} onClose={() => setRen(undefined)} onDone={reload} />
      <MenuHost />
      {chat.dialog}
    </div>
  )
}
