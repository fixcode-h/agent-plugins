import {
  Camera,
  Database,
  FileText,
  Hammer,
  Play,
  Plug,
  Square,
  SquareTerminal,
  Star,
  Undo2,
  User,
  Wand2,
  Zap,
} from 'lucide-react'
import type { GmStore, HistoryItem } from '../../server/types.ts'
import { op, pget, ppost, useAction, useLoad } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import {
  Badge,
  Card,
  Dot,
  LinkBtn,
  PageHead,
  TargetPicker,
  fmtTime,
  kindLabel,
  useTargetInfo,
  worldLabel,
} from '../ui.tsx'

/** 概览（图 1）：四个状态块、实例列表（点一行设为目标）、最近操作、常用 */
export function Overview() {
  const { project, state, setTarget, target, go, reload } = useUe()
  const { ui, cn, toast } = h()
  const { busy, run } = useAction()
  const { inst } = useTargetInfo()
  const hist = useLoad(() => pget<{ items: HistoryItem[] }>(project.id, 'history'), [project.id], 5000)
  const gm = useLoad(() => pget<GmStore>(project.id, 'gm'), [project.id])
  const live = (state?.instances ?? []).filter((i) => i.kind !== 'background')
  // 本次日志的错误 / 警告数：桥接自己数的，只取计数不取行
  const logs = useLoad(
    () =>
      live.length
        ? ppost<{ errors?: number; warnings?: number }>(project.id, 'logs', { limit: 1, since: 1e15 })
        : Promise.resolve(undefined),
    [project.id, live.length],
    10000,
  )
  const editor = live.find((i) => i.kind === 'editor')
  const pieRunning = !!editor?.worlds.some((w) => w.type === 'PIE')

  const pie = (action: string) =>
    run(`pie-${action}`, async () => {
      await op(project.id, 'pie', { action, players: 1, netMode: 'standalone' }, { instance: 'editor' })
      setTimeout(reload, 800)
    })

  const cards = [
    {
      icon: Plug,
      title: t('桥接插件'),
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
      value: `UE ${project.engine.version || '?'}`,
      desc: `${project.engine.source} · ${project.engine.dir || t('没找到引擎目录')}`,
    },
    {
      icon: Database,
      title: t('离线读取'),
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
      value: logs.data ? t('{e} 错误 · {w} 警告', { e: logs.data.errors ?? 0, w: logs.data.warnings ?? 0 }) : '—',
      danger: (logs.data?.errors ?? 0) > 0,
      desc: live.length ? t('点「日志」看详情') : t('UE 没在运行'),
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
        <TargetPicker />
        <ui.Button
          size="sm"
          variant="secondary"
          disabled={busy === 'build'}
          onClick={() => run('build', () => ppost(project.id, 'build').then(() => go('bridge')))}
        >
          <Hammer className="ue:h-3.5 ue:w-3.5" /> {t('编译')}
        </ui.Button>
        {editor ? (
          <>
            <ui.Button
              size="sm"
              variant="secondary"
              disabled={!!busy}
              onClick={() =>
                run('lc', () =>
                  op(project.id, 'livecoding', {}, { instance: 'editor' }, 120000).then(() =>
                    toast.success(t('Live Coding 已开始')),
                  ),
                )
              }
            >
              <Zap className="ue:h-3.5 ue:w-3.5" /> Live Coding
            </ui.Button>
            <ui.Button
              size="sm"
              variant="secondary"
              disabled={!!busy}
              onClick={() => void pie(pieRunning ? 'stop' : 'start')}
            >
              {pieRunning ? <Square className="ue:h-3.5 ue:w-3.5" /> : <Play className="ue:h-3.5 ue:w-3.5" />}
              {pieRunning ? t('停止 PIE') : t('开始 PIE')}
            </ui.Button>
          </>
        ) : (
          <ui.Button
            size="sm"
            disabled={!!busy || !state?.bridge}
            onClick={() =>
              run('ed', () =>
                ppost(project.id, 'editor').then(() => toast.success(t('编辑器启动中，加载完会自动连上'))),
              )
            }
          >
            <Play className="ue:h-3.5 ue:w-3.5" /> {t('启动编辑器')}
          </ui.Button>
        )}
      </PageHead>
      <div className="ue:flex ue:min-h-0 ue:flex-1 ue:flex-col ue:gap-4 ue:overflow-auto ue:p-6">
        <div className="ue:grid ue:gap-4 ue:sm:grid-cols-2 ue:xl:grid-cols-4">
          {cards.map((c) => (
            <div
              key={c.title}
              className="ue:flex ue:min-w-0 ue:flex-col ue:gap-1.5 ue:rounded-xl ue:border ue:border-line ue:bg-card ue:p-4"
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
            </div>
          ))}
        </div>

        <div className="ue:grid ue:gap-4 ue:xl:grid-cols-[1.4fr_1fr]">
          <Card title={t('实例')} aside={t('点一行设为「目标」，控制台、GM、对象都对它操作')}>
            <ul className="ue:flex ue:flex-col ue:divide-y ue:divide-line">
              {live.flatMap((i) =>
                [
                  { id: '', label: kindLabel(i.kind), detail: `PID ${i.pid} · ${t('端口')} ${i.port}` },
                  ...i.worlds.map((w) => ({
                    id: w.id,
                    label: worldLabel(w),
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
                        void run(it.id, () => ppost(project.id, 'undo', { id: it.id }).then(() => hist.reload()))
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
              onClick={() => go('watch', 'shot')}
              className="ue:flex ue:h-8 ue:cursor-pointer ue:items-center ue:gap-1.5 ue:rounded-lg ue:border ue:border-line ue:px-2.5 ue:text-body ue:text-fg ue:hover:bg-hover"
            >
              <Camera className="ue:h-3.5 ue:w-3.5 ue:text-subtle" /> {t('截视口')}
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}
