import { Hammer, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { h, t } from '../../../host.ts'
import type { PluginView } from './model.ts'

/**
 * UE 插件页状态条下面的「要处理」：只在有事时出现，一件事一行、按钮在行尾。
 * 升级不放这里（卡片和页头「全部升级」已经有），只放卡片上看不出该做什么的事。
 */
function Row({
  tone,
  icon: Icon,
  children,
  action,
}: {
  tone: 'warn' | 'info'
  icon: typeof Info
  children: ReactNode
  action?: ReactNode
}) {
  const { cn } = h()
  return (
    <div
      className={cn(
        'ue:flex ue:min-h-11 ue:items-center ue:gap-2.5 ue:px-4 ue:py-1.5 ue:text-body',
        tone === 'warn' ? 'ue:bg-warning/8' : 'ue:bg-accent-soft/60',
      )}
    >
      <Icon className={cn('ue:h-4 ue:w-4 ue:shrink-0', tone === 'warn' ? 'ue:text-warning' : 'ue:text-accent-text')} />
      <span className="ue:min-w-0 ue:flex-1 ue:text-fg">{children}</span>
      {action}
    </div>
  )
}

export function Todos({
  unchecked,
  legacy,
  stale,
  busy,
  onBuild,
}: {
  unchecked?: boolean
  legacy?: boolean
  stale: PluginView[]
  busy: boolean
  onBuild: () => void
}) {
  const { ui } = h()
  if (!unchecked && !legacy && !stale.length) return null
  return (
    <div className="ue:flex ue:flex-col ue:gap-px ue:bg-line">
      {stale.length > 0 && (
        <Row
          tone="warn"
          icon={Hammer}
          action={
            <ui.Button size="sm" variant="secondary" disabled={busy} onClick={onBuild}>
              <Hammer className="ue:h-3.5 ue:w-3.5" /> {t('编译')}
            </ui.Button>
          }
        >
          {t('{names} 编辑器里还是旧版本', { names: stale.map((v) => `${v.displayName} ${v.loaded}`).join('、') })}
          <span className="ue:text-muted">
            {' · '}
            {t('完整编译后重启编辑器才加载装好的版本（Live Coding 不够）')}
          </span>
        </Row>
      )}
      {legacy && (
        <Row tone="warn" icon={TriangleAlert}>
          {t(
            '现在装的是旧版桥接 AgentPanelBridge，升级会换成 UELink 并删掉旧插件；项目代码依赖了 AgentPanelBridge 模块的，Build.cs 里改成 UELinkCore。',
          )}
        </Row>
      )}
      {unchecked && (
        <Row tone="info" icon={Info}>
          {t('还没检查 UEKit 插件目录，点右上角「检查更新」从 GitHub 读取最新版本。')}
        </Row>
      )}
    </div>
  )
}
