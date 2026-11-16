import { Activity, Cpu, FileText, ListChecks, Save } from 'lucide-react'
import { useState } from 'react'
import type { HistoryItem } from '../../../server/types.ts'
import { op, pget, ppost, useAction, useLoad } from '../../api.ts'
import { useToChat } from '../../chat.tsx'
import { useUe } from '../../ctx.tsx'
import { h, t } from '../../host.ts'
import { STACK } from '../../split.tsx'
import { Card, Confirm, PageHead, fmtTime, kindLabel } from '../../ui.tsx'
import { RunBar } from '../RunBar.tsx'
import type { GtRunSummary } from '../uekit/GtRun.tsx'
import { attentionItems } from './attention.ts'
import { upgradesOf, useExtStatus } from './ext-data.ts'
import { Extensions, SelectionSlot } from './Extensions.tsx'
import { Favorites } from './Favorites.tsx'
import { Instances } from './Instances.tsx'
import { AttentionRow, Readout } from './parts.tsx'
import { Timeline } from './Timeline.tsx'

/**
 * 概览（设计稿 designs/UE插件优化与扩展-设计稿.md 三.1，效果图 1）：四个读数、「需要你处理」（按紧急程度，每条一个主动作）、
 * 右栏编辑器选中和扩展、「最近发生的」时间线，下面是实例和常用。
 * 崩溃、帧时间、最近的错误跟着左栏徽标的同一个请求来（UePage 在概览页加 overview=1），不另起轮询；
 * 扩展和测试结果打开页面时取一次
 */
export function Overview() {
  const { project, state, go, badges, reloadBadges } = useUe()
  const { toast } = h()
  const { busy, run } = useAction()
  const chat = useToChat()
  const hist = useLoad(() => pget<{ items: HistoryItem[] }>(project.id, 'history'), [project.id], 5000)
  const ext = useExtStatus(project.id)
  const live = (state?.instances ?? []).filter((i) => i.kind !== 'background')
  const gtLoaded = live.some((i) => i.online && i.extensions?.some((x) => x.name === 'GameTest'))
  const runs = useLoad(
    () =>
      gtLoaded
        ? op<{ runs: GtRunSummary[] }>(project.id, 'gt.runs').then((r) => r.runs ?? [])
        : Promise.resolve([] as GtRunSummary[]),
    [project.id, gtLoaded],
  )
  const [confirmAll, setConfirmAll] = useState(false)
  const reloadAll = () => {
    void hist.reload()
    reloadBadges()
  }
  const undoAll = () =>
    run('undo-all', async () => {
      setConfirmAll(false)
      const r = await ppost<{ done: number; failed: { summary: string; error: string }[] }>(project.id, 'undo/all')
      if (r.failed.length)
        toast.error(
          t('撤回了 {n} 处，{m} 处没撤回：{why}', {
            n: r.done,
            m: r.failed.length,
            why: r.failed.map((f) => `${f.summary}（${f.error}）`).join('；'),
          }),
        )
      else toast.success(t('撤回了 {n} 处修改', { n: r.done }))
      reloadAll()
    })
  const undoOne = (it: HistoryItem) =>
    void run(it.id, () => ppost(project.id, 'undo', { id: it.id }).then(reloadAll))

  const upgrades = upgradesOf(state, ext.data?.items)
  // 最近一次测试：gt.runs 新的在前还是在后不确定，按开始时间挑
  const lastRun = [...(runs.data ?? [])].sort((a, b) =>
    String(b.startedAtUtc ?? '').localeCompare(String(a.startedAtUtc ?? '')),
  )[0]
  const items = attentionItems({
    state,
    badges,
    extra: badges?.overview,
    lastRun,
    upgrades,
    go,
    toChat: chat.available ? chat.send : undefined,
    undoAll: () => setConfirmAll(true),
    fmt: fmtTime,
  })

  const errors = badges?.errors
  const frame = badges?.overview?.frame
  const pie = live.flatMap((i) => i.worlds).filter((w) => w.type === 'PIE').length
  const kinds = [...new Set(live.map((i) => kindLabel(i.kind)))]

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('概览')} desc={project.uproject}>
        <RunBar />
      </PageHead>
      <div className={STACK}>
        <div className="ue:grid ue:gap-px ue:bg-line ue:sm:grid-cols-2 ue:xl:grid-cols-4">
          <Readout
            icon={Cpu}
            title={t('运行中的进程')}
            value={live.length}
            unit={live.length ? kinds.join(' · ') : t('UE 没在运行')}
            desc={pie ? t('PIE 世界 {n} 个', { n: pie }) : undefined}
          />
          <Readout
            icon={Save}
            title={t('改了没保存')}
            value={badges?.dirty ?? 0}
            unit={t('个资源')}
            tone={badges?.dirty ? 'warn' : 'muted'}
            onClick={() => go('assets')}
          />
          <Readout
            icon={FileText}
            title={t('本次日志')}
            value={errors ?? '—'}
            unit={errors !== undefined ? t('个错误 · {w} 个警告', { w: badges?.warnings ?? 0 }) : undefined}
            desc={live.length ? undefined : t('UE 没在运行，点这里看上次的日志')}
            tone={errors ? 'danger' : 'muted'}
            onClick={() => go('logs', errors ? 'error' : '')}
          />
          <Readout
            icon={Activity}
            title={t('帧时间')}
            value={frame ? frame.frame.toFixed(1) : '—'}
            unit={frame ? `ms · Game ${frame.game.toFixed(1)} · GPU ${frame.gpu.toFixed(1)}` : undefined}
            desc={frame ? undefined : live.length ? t('取样中…') : t('UE 没在运行')}
            tone={frame && frame.frame > 33.4 ? 'warn' : 'muted'}
            onClick={() => go('perf')}
          />
        </div>

        <div className="ue:grid ue:gap-px ue:bg-line ue:xl:grid-cols-[1.6fr_1fr]">
          <Card
            title={
              <>
                <ListChecks className="ue:h-4 ue:w-4" /> {t('需要你处理')}
              </>
            }
            aside={items.length ? t('按紧急程度排') : undefined}
          >
            {items.length ? (
              <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line">
                {items.map((it) => (
                  <AttentionRow key={it.key} item={it} disabled={!!busy} />
                ))}
              </ul>
            ) : (
              <p className="ue:px-4 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
                {t('一切正常：没有崩溃、没保存的资源和要升级的插件')}
              </p>
            )}
          </Card>
          <div className="ue:flex ue:flex-col ue:gap-px ue:bg-line">
            <SelectionSlot />
            <Extensions exts={ext.data?.items} upgrades={upgrades} />
            <div className="ue:flex-1 ue:bg-card" />
          </div>
        </div>

        <Timeline history={hist.data?.items ?? []} busy={!!busy} onUndo={undoOne} />

        <div className="ue:grid ue:gap-px ue:bg-line ue:xl:grid-cols-[1.4fr_1fr]">
          <Instances />
          <Favorites />
        </div>
      </div>
      {chat.dialog}
      <Confirm
        open={confirmAll}
        title={t('全部撤回')}
        okText={t('全部撤回')}
        danger
        onOk={() => void undoAll()}
        onCancel={() => setConfirmAll(false)}
      >
        {t(
          '把还在生效的 {n} 处运行时修改按从新到旧撤回到改之前的值。资源的修改不在这里，用「资源」页的「放弃改动」。',
          {
            n: badges?.undoable ?? 0,
          },
        )}
      </Confirm>
    </div>
  )
}
