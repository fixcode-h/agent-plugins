import { Camera, Database, FileText, Plug, SquareTerminal, Star, Undo2, User, Wand2 } from 'lucide-react'
import { useState } from 'react'
import type { GmStore, HistoryItem } from '../../server/types.ts'
import { op, pget, ppost, useAction, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import {
  Badge,
  Card,
  Confirm,
  Dot,
  LinkBtn,
  PageHead,
  WorldBadge,
  fmtTime,
  kindLabel,
  useTargetInfo,
  worldLabel,
} from '../ui.tsx'
import { RunBar } from './RunBar.tsx'

/**
 * 概览（图 1）：四个状态块（点了去对应的页）、实例列表（点一行设为目标）、最近操作（还在生效的能一键撤回）、常用。
 * 日志计数用左栏同一份 badges，不再单独请求
 */
export function Overview() {
  const { project, state, setTarget, target, go, badges, reloadBadges, openShot } = useUe()
  const { cn, toast } = h()
  const { busy, run } = useAction()
  const { inst } = useTargetInfo()
  const hist = useLoad(() => pget<{ items: HistoryItem[] }>(project.id, 'history'), [project.id], 5000)
  const gm = useLoad(() => pget<GmStore>(project.id, 'gm'), [project.id])
  const live = (state?.instances ?? []).filter((i) => i.kind !== 'background')
  const [confirmAll, setConfirmAll] = useState(false)
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
      void hist.reload()
      reloadBadges()
    })

  const cards = [
    {
      icon: Plug,
      title: t('桥接插件'),
      to: () => go('bridge'),
      value: state?.bridge ? t('已安装') : t('未安装'),
      badge: state?.bridge ? (
        <Badge tone={state.bundled && state.bundled !== state.bridge ? 'warn' : 'ok'}>{state.bridge}</Badge>
      ) : null,
      desc: state?.bridge
        ? state.bundled && state.bundled !== state.bridge
          ? t('有新版本 {v}，到「桥接与权限」升级', { v: state.bundled })
          : `Plugins/AgentPanelBridge · ${project.install?.mode === 'vcs' ? t('已加入版本管理') : t('只在本机')}`
        : t('到「桥接与权限」安装，装好后编辑器重启生效'),
    },
    {
      icon: Plug,
      title: t('引擎'),
      to: () => go('bridge'),
      value: `UE ${project.engine.version || '?'}`,
      desc: `${project.engine.source} · ${project.engine.dir || t('没找到引擎目录')}`,
    },
    {
      icon: Database,
      title: t('离线读取'),
      to: () => go('assets'),
      value: state?.background.running
        ? t('后台编辑器在线')
        : state?.background.starting
          ? t('后台编辑器启动中…')
          : t('后台编辑器未启动'),
      desc:
        state?.background.error ||
        t('编辑器关着时读资源自动启动，闲置 {n} 分钟退出', { n: Number(h().config().idleMinutes) || 10 }),
      dot: state?.background.running
        ? ('ok' as const)
        : state?.background.starting
          ? ('run' as const)
          : ('muted' as const),
    },
    {
      icon: FileText,
      title: t('本次日志'),
      to: () => go('logs', (badges?.errors ?? 0) > 0 ? 'error' : ''),
      value:
        badges?.errors !== undefined ? t('{e} 错误 · {w} 警告', { e: badges.errors, w: badges.warnings ?? 0 }) : '—',
      danger: (badges?.errors ?? 0) > 0,
      desc: live.length
        ? (badges?.errors ?? 0) > 0
          ? t('点这里只看错误')
          : t('点这里看日志')
        : t('UE 没在运行，点这里看上次的日志'),
    },
  ]

  const favs = [
    ...(gm.data?.macros ?? []).map((m) => ({
      key: `m:${m.id}`,
      icon: Wand2,
      label: t('{name}（宏 · {n} 步）', { name: m.name, n: m.steps.length }),
      run: () => ppost(project.id, 'macro', { id: m.id, target }),
    })),
    ...(gm.data?.favGm ?? []).map((g) => ({
      key: `g:${g}`,
      icon: Wand2,
      label: g,
      run: () => op(project.id, 'gm.run', { name: g.split(' ')[0], args: g.split(' ').slice(1) }, target),
    })),
    ...(gm.data?.favConsole ?? []).map((c) => ({
      key: `c:${c}`,
      icon: SquareTerminal,
      label: c,
      run: () => ppost(project.id, 'console', { command: c, target }),
    })),
  ]

  return (
    <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col">
      <PageHead title={t('概览')} desc={project.uproject}>
        <RunBar />
      </PageHead>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-4 ue:overflow-auto ue:p-6">
        <div className="ue:grid ue:gap-4 ue:sm:grid-cols-2 ue:xl:grid-cols-4">
          {cards.map((c) => (
            <button
              type="button"
              key={c.title}
              onClick={c.to}
              className="ue:flex ue:min-w-0 ue:cursor-pointer ue:flex-col ue:gap-1.5 ue:rounded-xl ue:border ue:border-line ue:bg-card ue:p-4 ue:text-left ue:transition-colors ue:hover:border-line-strong ue:hover:bg-hover"
            >
              <div className="ue:flex ue:items-center ue:gap-1.5 ue:text-footnote ue:text-subtle">
                <c.icon className="ue:h-3.5 ue:w-3.5" /> {c.title}
              </div>
              <div
                className={cn(
                  'ue:flex ue:items-center ue:gap-2 ue:text-heading ue:font-medium',
                  c.danger ? 'ue:text-danger' : 'ue:text-fg',
                )}
              >
                {c.dot && <Dot tone={c.dot} />}
                {c.value}
                {c.badge}
              </div>
              <div className="ue:text-footnote ue:break-all ue:text-subtle">{c.desc}</div>
            </button>
          ))}
        </div>

        <div className="ue:grid ue:gap-4 ue:xl:grid-cols-[1.4fr_1fr]">
          <Card title={t('实例')} aside={t('点一行设为「目标」，控制台、GM、对象都对它操作')}>
            <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line">
              {live.flatMap((i) =>
                [
                  {
                    id: '',
                    label: kindLabel(i.kind),
                    badge: null,
                    detail: `PID ${i.pid} · ${t('端口')} ${i.port}`,
                  },
                  ...i.worlds.map((w) => ({
                    id: w.id,
                    label: worldLabel(w),
                    badge: <WorldBadge world={w} />,
                    detail: [w.player, w.map].filter(Boolean).join(' · '),
                  })),
                ].map((w) => {
                  const on = inst?.pid === i.pid && (target.world ?? '') === w.id
                  return (
                    <li key={`${i.pid}|${w.id}`}>
                      <button
                        type="button"
                        onClick={() => setTarget(i.pid, i.kind, w.id)}
                        className={cn(
                          'ue:flex ue:w-full ue:cursor-pointer ue:items-center ue:gap-3 ue:px-4 ue:py-2.5 ue:text-left ue:hover:bg-hover',
                          on && 'ue:bg-sel',
                          w.id && 'ue:pl-9',
                        )}
                      >
                        <Dot tone={i.online ? 'ok' : 'danger'} />
                        <span className="ue:text-body ue:text-fg">{w.label}</span>
                        {w.badge}
                        <span className="ue:min-w-0 ue:truncate ue:text-footnote ue:text-subtle">
                          {i.online ? w.detail : i.error}
                        </span>
                        {on && (
                          <span className="ue:ml-auto">
                            <Badge tone="accent">{t('当前目标')}</Badge>
                          </span>
                        )}
                      </button>
                    </li>
                  )
                }),
              )}
              <li className="ue:flex ue:items-center ue:gap-3 ue:px-4 ue:py-2.5 ue:text-footnote ue:text-subtle">
                <Dot />{' '}
                {live.length
                  ? t('独立进程（-game / 专用服务器）启动后会出现在这里')
                  : t('UE 没在运行。启动编辑器或游戏后，装了桥接插件的进程会自动出现在这里')}
              </li>
            </ul>
          </Card>

          <Card title={t('最近操作')} aside={<LinkBtn onClick={() => go('history')}>{t('全部')}</LinkBtn>}>
            {!!badges?.undoable && (
              <div className="ue:flex ue:items-center ue:gap-2 ue:border-b ue:border-line ue:bg-warning/10 ue:px-4 ue:py-2 ue:text-footnote ue:text-fg">
                <span className="ue:min-w-0 ue:flex-1">{t('{n} 处运行时修改还在生效', { n: badges.undoable })}</span>
                <LinkBtn disabled={!!busy} onClick={() => setConfirmAll(true)}>
                  <Undo2 className="ue:h-3 ue:w-3" /> {t('全部撤回')}
                </LinkBtn>
              </div>
            )}
            <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line">
              {(hist.data?.items ?? []).slice(0, 6).map((it) => (
                <li key={it.id} className="ue:flex ue:items-start ue:gap-3 ue:px-4 ue:py-2.5">
                  <span className="ue:w-11 ue:shrink-0 ue:font-mono ue:text-footnote ue:text-subtle">
                    {fmtTime(it.at)}
                  </span>
                  <div className="ue:min-w-0 ue:flex-1">
                    <div className="ue:flex ue:items-center ue:gap-1.5 ue:text-footnote ue:text-muted">
                      <User className="ue:h-3 ue:w-3" />
                      {it.actor.kind === 'user'
                        ? t('你')
                        : t('对话 · {agent}', { agent: it.actor.agent || it.actor.taskId })}
                    </div>
                    <div className="ue:truncate ue:font-mono ue:text-footnote ue:text-fg" title={it.summary}>
                      {it.op} {it.summary}
                    </div>
                    {it.error && <div className="ue:truncate ue:text-footnote ue:text-danger">{it.error}</div>}
                  </div>
                  {it.undo && !it.undone ? (
                    <LinkBtn
                      disabled={!!busy}
                      onClick={() =>
                        void run(it.id, () =>
                          ppost(project.id, 'undo', { id: it.id }).then(() => {
                            void hist.reload()
                            reloadBadges()
                          }),
                        )
                      }
                    >
                      <Undo2 className="ue:h-3 ue:w-3" /> {t('撤回修改')}
                    </LinkBtn>
                  ) : (
                    <Badge tone={it.ok ? (it.undone ? 'muted' : 'ok') : 'danger'}>
                      {it.undone ? t('已撤回') : it.ok ? t('成功') : t('失败')}
                    </Badge>
                  )}
                </li>
              ))}
              {!hist.data?.items.length && (
                <li className="ue:px-4 ue:py-6 ue:text-center ue:text-footnote ue:text-subtle">
                  {t('还没有修改。你和 Agent 的修改都记在这里，运行时修改可以撤回')}
                </li>
              )}
            </ul>
          </Card>
        </div>

        <Card
          title={
            <>
              <Star className="ue:h-4 ue:w-4" /> {t('常用')}
            </>
          }
          aside={t('在控制台和 GM 里点星标加到这里')}
        >
          <div className="ue:flex ue:flex-wrap ue:gap-2 ue:p-4">
            {favs.map((f) => (
              <button
                key={f.key}
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void run(f.key, async () => {
                    await f.run()
                    toast.success(t('已执行：{what}', { what: f.label }))
                  })
                }
                className="ue:flex ue:h-8 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-lg ue:border ue:border-line ue:px-2.5 ue:text-body ue:text-fg ue:hover:bg-hover"
              >
                <f.icon className="ue:h-3.5 ue:w-3.5 ue:text-subtle" /> {f.label}
              </button>
            ))}
            <button
              type="button"
              onClick={openShot}
              className="ue:flex ue:h-8 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-lg ue:border ue:border-line ue:px-2.5 ue:text-body ue:text-fg ue:hover:bg-hover"
            >
              <Camera className="ue:h-3.5 ue:w-3.5 ue:text-subtle" /> {t('截视口')}
            </button>
          </div>
        </Card>
      </div>
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
