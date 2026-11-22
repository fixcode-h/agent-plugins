import { MonitorPlay } from 'lucide-react'
import type { LaunchProgress } from '../../server/types.ts'
import { op, useAction } from '../api.ts'
import { useUe } from '../ctx.tsx'
import { h, t } from '../host.ts'
import { useLaunch } from '../launch.ts'
import { LaunchButton } from '../launch-progress/LaunchButton.tsx'
import { useTargetInfo } from '../ui.tsx'

/** 三态：游戏在跑（PIE 或独立游戏进程）/ 编辑器连着但游戏没开 / UE 没在运行 */
export type ConnState = 'game' | 'editor' | 'off'

/** 按 UE 页的目标算现在是哪一态：GM、对象调用、测试这些「要游戏在跑」的页面共用 */
export function useConnState(): { state: ConnState; label: string } {
  const { inst, world } = useTargetInfo()
  if (!inst) return { state: 'off', label: t('UE 没在运行') }
  const pie = inst.worlds.find((w) => w.type === 'PIE')
  if (inst.kind !== 'editor')
    return { state: 'game', label: t('游戏运行中 · {k} {pid}', { k: inst.kind, pid: inst.pid }) }
  if (pie || world?.type === 'PIE')
    return { state: 'game', label: t('PIE 运行中 · {map}', { map: (world ?? pie)?.map.split('/').pop() ?? '' }) }
  return { state: 'editor', label: t('编辑器已连接 · 游戏没运行') }
}

/**
 * 连接状态胶囊（GM 页梳理 L2，效果图 designs/GM页梳理与扩展-效果图）：一处说清「现在能不能执行」，并给一键解决的入口：
 * 绿 游戏在跑；黄 编辑器连着、游戏没开 + 「开始 PIE」；灰 UE 没在运行 + 「启动编辑器」（复用 LaunchButton，带启动进度）。
 * 各面板就不用再各写一句原因，只把按钮置灰、悬停写短原因
 */
export function ConnPill() {
  const { project, reload } = useUe()
  const { busy, run } = useAction()
  const launch = useLaunch()
  const c = useConnState()
  const startPie = () =>
    run('pie', async () => {
      await op(project.id, 'pie', { action: 'start', players: 1, netMode: 'standalone' }, { instance: 'editor' })
      setTimeout(reload, 800)
    })
  return (
    <ConnPillView
      {...c}
      pieBusy={busy === 'pie'}
      onPie={startPie}
      launch={{ progress: launch.progress, busy: launch.busy, start: () => void launch.start(false) }}
    />
  )
}

/** 只管画（设置 →「控件样式」的样张也用它，不连 UE） */
export function ConnPillView({
  state,
  label,
  pieBusy,
  onPie,
  launch,
}: {
  state: ConnState
  label: string
  pieBusy?: boolean
  onPie: () => void
  launch: { progress?: LaunchProgress; busy?: boolean; start: () => void }
}) {
  const { ui, cn } = h()
  return (
    <div className="ue:flex ue:items-center ue:gap-2">
      <span
        className="ue:inline-flex ue:h-7 ue:max-w-80 ue:items-center ue:gap-1.5 ue:rounded-full ue:border ue:border-line ue:bg-card ue:px-2.5 ue:text-footnote ue:text-fg"
        title={label}
      >
        <span
          className={cn(
            'ue:h-1.5 ue:w-1.5 ue:shrink-0 ue:rounded-full',
            state === 'game' ? 'ue:bg-success' : state === 'editor' ? 'ue:bg-warning' : 'ue:bg-subtle',
          )}
        />
        <span className="ue:truncate">{label}</span>
      </span>
      {state === 'editor' && (
        <ui.Button size="sm" disabled={pieBusy} onClick={onPie}>
          <MonitorPlay className="ue:h-3.5 ue:w-3.5" /> {t('开始 PIE')}
        </ui.Button>
      )}
      {state === 'off' && (
        <LaunchButton size="sm" progress={launch.progress} disabled={launch.busy} onClick={launch.start}>
          {t('启动编辑器')}
        </LaunchButton>
      )}
    </div>
  )
}

export function ConnPillSpecimen() {
  const noop = () => undefined
  return (
    <div className="ue:flex ue:flex-col ue:items-start ue:gap-2">
      <ConnPillView
        state="game"
        label={t('PIE 运行中 · {map}', { map: 'Lobby' })}
        onPie={noop}
        launch={{ start: noop }}
      />
      <ConnPillView state="editor" label={t('编辑器已连接 · 游戏没运行')} onPie={noop} launch={{ start: noop }} />
      <ConnPillView state="off" label={t('UE 没在运行')} onPie={noop} launch={{ start: noop }} />
    </div>
  )
}
