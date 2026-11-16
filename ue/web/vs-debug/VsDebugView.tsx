import {
  ArrowDownToLine,
  ArrowRightToLine,
  ArrowUpFromLine,
  Bug,
  Loader2,
  Pause,
  Play,
  PlugZap,
  RotateCcw,
  Square,
  StepForward,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { VsBreakpoint, VsDebugState } from '../../server/types.ts'
import { h, t } from '../host.ts'
import { Badge, Card, Dot } from '../ui.tsx'
import { canDo, phaseLine, phaseOf, startArgs, type LaunchParams } from './model.ts'
import { BreakpointList, LaunchParamsForm, StopInfo } from './parts.tsx'

/**
 * VS 调试卡片的样子（UEToVS 0.8.0 的调试控制，协议见 UEToVS 仓库 docs/design/VS-调试控制.md）：
 * 只管显示和把点击交出去，不发请求、不弹确认。真实页面由 VsDebugCard 接上接口和确认弹窗，
 * 设置 →「组件」里的示例直接喂假数据，两边长得一模一样
 */
export interface VsDebugViewProps {
  vs: VsDebugState
  /** 正在执行的操作（op 名），期间按钮都禁用，防止连点 */
  busy?: string
  /** 正在打开 VS（open-vs 要等一两分钟） */
  opening?: boolean
  params: LaunchParams
  onParams: (p: LaunchParams) => void
  /**
   * 一个调试操作：op 是协议里的名字，args 原样转给管道；key 区分同一个 op 的不同按钮（三种单步、两种启动），
   * 用来在那个按钮上转圈。停止、重启的确认由外层做
   */
  onOp: (op: string, args?: Record<string, unknown>, key?: string) => void
  onOpenVs: () => void
}

export function VsDebugView({ vs, busy, opening, params, onParams, onOp, onOpenVs }: VsDebugViewProps) {
  const s = vs.status
  const phase = phaseOf(vs)
  const line = phaseLine(vs)
  const can = canDo(phase)
  const off = !!busy
  const procs = (s?.processes ?? []).map((p) => `${p.name} ${p.pid}`).join(', ')
  const meta = [s?.startupProject, s?.configuration?.replace('|', ' · ')].filter(Boolean).join(' · ')
  return (
    <Card
      title={
        <>
          <Bug className="ue:h-4 ue:w-4" /> {t('VS 调试')}
        </>
      }
      aside={
        <span className="ue:flex ue:min-w-0 ue:items-center ue:gap-1.5">
          {phase === 'building' || phase === 'launching' ? (
            <Loader2 className="ue:h-3 ue:w-3 ue:shrink-0 ue:animate-spin ue:text-run" />
          ) : (
            <Dot tone={line.tone} />
          )}
          <span className="ue:truncate">{phase === 'off' ? t('不可用') : line.text}</span>
        </span>
      }
      bodyClass="ue:flex ue:flex-col ue:gap-3 ue:px-4 ue:py-3"
    >
      {phase === 'off' ? (
        <Unavailable vs={vs} opening={opening} onOpenVs={onOpenVs} />
      ) : (
        <>
          <div className="ue:flex ue:min-w-0 ue:flex-col ue:gap-0.5">
            <div className="ue:flex ue:min-w-0 ue:items-center ue:gap-2">
              <span className="ue:text-body ue:font-medium ue:text-fg">{line.text}</span>
              {phase === 'break' && !!s?.breakCount && <Badge>{t('第 {n} 次停下', { n: s.breakCount })}</Badge>}
              {s?.lastBuildFailed && phase === 'design' && <Badge tone="danger">{t('上次编译失败')}</Badge>}
            </div>
            {meta && (
              <span className="ue:truncate ue:text-caption ue:text-subtle" title={meta}>
                {meta}
              </span>
            )}
            {procs && (
              <span className="ue:truncate ue:text-caption ue:text-subtle" title={procs}>
                {t('调试中的进程：{p}', { p: procs })}
              </span>
            )}
          </div>

          <Toolbar can={can} phase={phase} busy={busy} onOp={onOp} params={params} />

          {phase === 'break' && s && <StopInfo status={s} />}

          <LaunchParamsForm value={params} onChange={onParams} current={s?.configuration} disabled={!can.start} />

          <BreakpointList
            items={vs.breakpoints ?? []}
            total={s?.breakpoints}
            debugging={phase === 'run' || phase === 'break'}
            disabled={off}
            onToggle={(b: VsBreakpoint) => onOp('bp.enable', { index: b.i, enabled: !b.enabled })}
            onRemove={(b: VsBreakpoint) => onOp('bp.remove', { index: b.i })}
            onClearAgent={() => onOp('bp.clear', { scope: 'agent' })}
          />
        </>
      )}
    </Card>
  )
}

/** 按钮两组：会话（启动、不调试启动、附加、停止、重启）和执行（暂停 / 继续、三种单步），不该点的禁用而不是藏起来，位置不跳 */
function Toolbar({
  can,
  phase,
  busy,
  onOp,
  params,
}: {
  can: ReturnType<typeof canDo>
  phase: ReturnType<typeof phaseOf>
  busy?: string
  onOp: VsDebugViewProps['onOp']
  params: LaunchParams
}) {
  const { ui } = h()
  const off = !!busy
  const spin = (op: string, icon: ReactNode) =>
    busy === op ? <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" /> : icon
  const ib = (
    key: string,
    op: string,
    args: Record<string, unknown> | undefined,
    Icon: typeof Play,
    label: string,
    ok: boolean,
  ) => (
    <ui.IconButton
      icon={Icon}
      size="sm"
      label={label}
      disabled={off || !ok}
      className={busy === key ? 'ue:animate-pulse' : undefined}
      onClick={() => onOp(op, args, key)}
    />
  )
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-1.5">
      {phase === 'run' || phase === 'break' ? (
        <ui.Button size="sm" variant="danger-outline" disabled={off || !can.stop} onClick={() => onOp('stop')}>
          {spin('stop', <Square className="ue:h-3.5 ue:w-3.5" />)} {t('停止')}
        </ui.Button>
      ) : (
        <ui.Button
          size="sm"
          disabled={off || !can.start}
          title={t('等于在 VS 里按 F5：先编译再启动')}
          onClick={() => onOp('start', startArgs(params, false))}
        >
          {spin('start', <Play className="ue:h-3.5 ue:w-3.5" />)} {t('启动（F5）')}
        </ui.Button>
      )}
      {phase === 'run' || phase === 'break' ? (
        <ui.Button size="sm" variant="secondary" disabled={off || !can.restart} onClick={() => onOp('restart')}>
          {spin('restart', <RotateCcw className="ue:h-3.5 ue:w-3.5" />)} {t('重启')}
        </ui.Button>
      ) : phase === 'building' || phase === 'launching' ? (
        <ui.Button size="sm" variant="danger-outline" disabled={off || !can.stop} onClick={() => onOp('stop')}>
          {spin('stop', <Square className="ue:h-3.5 ue:w-3.5" />)} {t('取消')}
        </ui.Button>
      ) : (
        <>
          <ui.Button
            size="sm"
            variant="secondary"
            disabled={off || !can.start}
            title={t('等于 Ctrl+F5：不挂调试器')}
            onClick={() => onOp('start', startArgs(params, true), 'start-nodebug')}
          >
            {spin('start-nodebug', <Play className="ue:h-3.5 ue:w-3.5" />)} {t('不调试启动')}
          </ui.Button>
          <ui.Button
            size="sm"
            variant="ghost"
            disabled={off || !can.attach}
            title={t('把 VS 的调试器附加到已经开着的 UnrealEditor 上')}
            onClick={() => onOp('attach')}
          >
            {spin('attach', <PlugZap className="ue:h-3.5 ue:w-3.5" />)} {t('附加到编辑器')}
          </ui.Button>
        </>
      )}
      <span className="ue:mx-0.5 ue:h-5 ue:w-px ue:bg-line" aria-hidden />
      {phase === 'break'
        ? ib('continue', 'continue', undefined, Play, t('继续'), can.resume)
        : ib('pause', 'pause', undefined, Pause, t('暂停'), can.pause)}
      {ib('step-over', 'step', { kind: 'over' }, StepForward, t('单步跳过'), can.step)}
      {ib('step-into', 'step', { kind: 'into' }, ArrowDownToLine, t('单步进入'), can.step)}
      {ib('step-out', 'step', { kind: 'out' }, ArrowUpFromLine, t('单步跳出'), can.step)}
    </div>
  )
}

/** 不可用：原样显示原因；没开 VS 且本机找得到 devenv 时给「打开 VS」 */
function Unavailable({ vs, opening, onOpenVs }: { vs: VsDebugState; opening?: boolean; onOpenVs: () => void }) {
  const { ui } = h()
  const canOpen = vs.reason === 'no-vs' && !!vs.devenv
  return (
    <div className="ue:flex ue:flex-col ue:items-start ue:gap-2">
      <p className="ue:text-body ue:leading-relaxed ue:text-muted">{vs.message || t('VS 调试不可用')}</p>
      {canOpen && (
        <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
          <ui.Button size="sm" variant="secondary" disabled={opening} onClick={onOpenVs}>
            {opening ? (
              <Loader2 className="ue:h-3.5 ue:w-3.5 ue:animate-spin" />
            ) : (
              <ArrowRightToLine className="ue:h-3.5 ue:w-3.5" />
            )}
            {opening ? t('正在打开 VS…') : t('打开 VS')}
          </ui.Button>
          <span className="ue:text-caption ue:text-subtle">
            {opening ? t('等 VS 加载完解决方案，可能要一两分钟') : vs.solution}
          </span>
        </div>
      )}
    </div>
  )
}
