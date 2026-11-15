import { Loader2, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { LaunchProgress } from '../../server/types.ts'
import { h, t } from '../host.ts'
import { launchTip, stageLabel } from './store.ts'

/**
 * 「启动编辑器」按钮（概览页头、UE 没在运行的空页面共用）：平时是普通按钮；
 * 面板起的编辑器在启动时，按钮换成次要底色，文字是阶段名和估算百分比，底边一条细进度条，悬停看说明。
 * 进度条用面板进度条的变量（--c-progress-track、--c-progress-radius），在设置 →「组件」里跟「进度条」一起调
 */
export function LaunchButton({
  progress,
  icon: Icon,
  size,
  variant = 'primary',
  disabled,
  onClick,
  children,
}: {
  progress?: LaunchProgress
  icon?: LucideIcon
  size?: 'sm' | 'md'
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const { ui, cn } = h()
  const running = progress?.status === 'running'
  // 悬停说明里的「已用 N 秒」每秒走一次；推送也是一秒一条，这里只为没推送时（卡在 UE 弹窗）秒数照样走
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])
  if (!running || !progress)
    return (
      <ui.Button size={size} variant={variant} disabled={disabled} onClick={onClick}>
        {Icon && <Icon className="ue:h-3.5 ue:w-3.5" />} {children}
      </ui.Button>
    )
  const warn = !!progress.waiting
  return (
    <ui.Button
      size={size}
      variant="secondary"
      aria-busy
      // 启动中再点也没用（服务端会重新跟一份），按钮只用来看进度
      aria-disabled
      title={launchTip(progress, now)}
      className="ue:relative ue:min-w-[10.5rem] ue:cursor-default ue:justify-center ue:overflow-hidden"
      onClick={() => undefined}
    >
      <Loader2 className={cn('ue:h-3.5 ue:w-3.5 ue:animate-spin', warn ? 'ue:text-warning' : 'ue:text-accent')} />
      <span className="ue:truncate">{stageLabel(progress)}</span>
      <span className="ue:tabular-nums ue:text-subtle">{progress.percent}%</span>
      <span
        role="progressbar"
        aria-label={t('编辑器启动进度')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        className="ue:absolute ue:inset-x-0 ue:bottom-0 ue:h-0.5 ue:bg-(--c-progress-track)"
      >
        <span
          className={cn(
            'ue:block ue:h-full ue:rounded-(--c-progress-radius) ue:transition-[width] ue:duration-700',
            warn ? 'ue:bg-warning' : 'ue:bg-accent',
          )}
          style={{ width: `${progress.percent}%` }}
        />
      </span>
    </ui.Button>
  )
}

/** 设置 →「组件」里的示例：几个典型阶段并排，不连 UE（示例数据，不翻译阶段以外的东西） */
export function LaunchButtonSpecimen() {
  const base = { pid: 1, startedAt: Date.now() - 30000, expectedMs: 90000, status: 'running' as const }
  const samples: LaunchProgress[] = [
    { ...base, stage: 'modules', percent: 27 },
    { ...base, stage: 'assets', percent: 48, shadersLeft: 1834, shadersMax: 2410 },
    { ...base, stage: 'init', percent: 6, waiting: 'rebuild' },
    { ...base, stage: 'final', percent: 96 },
  ]
  return (
    <div className="ue:flex ue:flex-wrap ue:items-center ue:gap-2">
      <LaunchButton onClick={() => undefined}>{t('启动编辑器')}</LaunchButton>
      {samples.map((p, i) => (
        <LaunchButton key={i} progress={p} onClick={() => undefined}>
          {t('启动编辑器')}
        </LaunchButton>
      ))}
    </div>
  )
}
